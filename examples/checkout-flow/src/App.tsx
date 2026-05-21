import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { CATEGORIES, fmtPrice, PRODUCTS, type Product } from './products.ts';

type View = 'browse' | 'product' | 'cart' | 'checkout' | 'paying' | 'success';
type PaymentMethod = 'card' | 'external';

interface CartItem { id: string; qty: number; }

interface Address {
  name: string; street: string; city: string; state: string; zip: string;
}

interface CardInfo { number: string; expiry: string; cvv: string; }

const TAX_RATE = 0.0875; // 8.75%
const SHIPPING_FREE_OVER = 35;
const SHIPPING_COST = 5.99;
const PAYMENT_PROVIDER_ORIGIN = 'http://localhost:5177';
const MERCHANT_NAME = 'Hover Store';

const emptyAddress: Address = { name: '', street: '', city: '', state: '', zip: '' };
const emptyCard: CardInfo = { number: '', expiry: '', cvv: '' };

export default function App() {
  const [view, setView] = useState<View>('browse');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<Product['category'] | 'All'>('All');
  const [address, setAddress] = useState<Address>(emptyAddress);
  const [method, setMethod] = useState<PaymentMethod>('card');
  const [card, setCard] = useState<CardInfo>(emptyCard);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [paymentRef, setPaymentRef] = useState<string | null>(null);
  const [providerError, setProviderError] = useState<string | null>(null);

  // ─── cart math ──────────────────────────────────────────────────
  const itemCount = cart.reduce((sum, ci) => sum + ci.qty, 0);
  const cartLines = useMemo(
    () =>
      cart.map(ci => {
        const product = PRODUCTS.find(p => p.id === ci.id)!;
        return { ...ci, product, lineTotal: product.price * ci.qty };
      }),
    [cart],
  );
  const subtotal = cartLines.reduce((s, l) => s + l.lineTotal, 0);
  const shipping = subtotal >= SHIPPING_FREE_OVER || subtotal === 0 ? 0 : SHIPPING_COST;
  const tax = subtotal * TAX_RATE;
  const total = subtotal + shipping + tax;

  // ─── cart ops ───────────────────────────────────────────────────
  function addToCart(id: string, qty = 1) {
    setCart(c => {
      const existing = c.find(x => x.id === id);
      if (existing) return c.map(x => (x.id === id ? { ...x, qty: x.qty + qty } : x));
      return [...c, { id, qty }];
    });
  }
  function updateQty(id: string, qty: number) {
    if (qty <= 0) {
      setCart(c => c.filter(x => x.id !== id));
      return;
    }
    setCart(c => c.map(x => (x.id === id ? { ...x, qty } : x)));
  }
  function removeFromCart(id: string) {
    setCart(c => c.filter(x => x.id !== id));
  }

  // ─── place order ────────────────────────────────────────────────
  function placeOrder() {
    if (method === 'external') {
      payViaProvider();
      return;
    }
    // Card path: simple completion
    finalizeOrder({ ref: 'CARD-' + Math.random().toString(36).slice(2, 9).toUpperCase() });
  }

  function payViaProvider() {
    const ref = 'ORD-' + Math.random().toString(36).slice(2, 9).toUpperCase();
    const url =
      `${PAYMENT_PROVIDER_ORIGIN}/?ref=${encodeURIComponent(ref)}` +
      `&amount=${encodeURIComponent(fmtPrice(total))}` +
      `&merchant=${encodeURIComponent(MERCHANT_NAME)}` +
      `&return=${encodeURIComponent(location.origin)}`;
    const w = window.open(url, 'payhover-checkout', 'width=520,height=720');
    if (!w) {
      setProviderError('Pop-up blocked. Please allow pop-ups and retry.');
      return;
    }
    setProviderError(null);
    setView('paying');
  }

  useEffect(() => {
    if (view !== 'paying') return;
    const handler = (e: MessageEvent) => {
      if (e.origin !== PAYMENT_PROVIDER_ORIGIN) return;
      if (e.data?.type !== 'payment-result') return;
      if (e.data.status === 'approved') {
        finalizeOrder({ ref: e.data.ref });
      } else {
        setProviderError('Payment declined by provider. Choose another method.');
        setView('checkout');
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [view]);

  function finalizeOrder({ ref }: { ref: string }) {
    setOrderId('ORD-' + Math.random().toString(36).slice(2, 8).toUpperCase());
    setPaymentRef(ref);
    setView('success');
  }

  function resetAll() {
    setView('browse');
    setSelectedId(null);
    setCart([]);
    setAddress(emptyAddress);
    setCard(emptyCard);
    setMethod('card');
    setOrderId(null);
    setPaymentRef(null);
    setProviderError(null);
  }

  // ─── render ─────────────────────────────────────────────────────
  return (
    <div className="store">
      <header className="topbar">
        <button
          className="logo"
          onClick={() => { setView('browse'); setSelectedId(null); }}
          data-testid="logo"
        >
          🛒 {MERCHANT_NAME}
        </button>
        <input
          type="search"
          className="search"
          placeholder="Search products"
          value={search}
          onChange={e => { setSearch(e.target.value); setView('browse'); }}
          aria-label="search"
          data-testid="search"
        />
        <button
          className="cart-btn"
          onClick={() => setView('cart')}
          aria-label="open cart"
          data-testid="cart-button"
        >
          🛒 Cart <span className="cart-count" data-testid="cart-count">{itemCount}</span>
        </button>
      </header>

      <main>
        {view === 'browse' && (
          <Browse
            search={search}
            category={activeCategory}
            setCategory={setActiveCategory}
            onSelect={id => { setSelectedId(id); setView('product'); }}
            onAdd={id => addToCart(id, 1)}
          />
        )}
        {view === 'product' && selectedId && (
          <ProductDetail
            product={PRODUCTS.find(p => p.id === selectedId)!}
            onAdd={qty => { addToCart(selectedId, qty); setView('cart'); }}
            onBack={() => setView('browse')}
          />
        )}
        {view === 'cart' && (
          <Cart
            lines={cartLines}
            subtotal={subtotal}
            shipping={shipping}
            tax={tax}
            total={total}
            updateQty={updateQty}
            remove={removeFromCart}
            onCheckout={() => setView('checkout')}
            onBack={() => setView('browse')}
          />
        )}
        {view === 'checkout' && (
          <Checkout
            lines={cartLines}
            subtotal={subtotal}
            shipping={shipping}
            tax={tax}
            total={total}
            address={address}
            setAddress={setAddress}
            method={method}
            setMethod={setMethod}
            card={card}
            setCard={setCard}
            providerError={providerError}
            onBack={() => setView('cart')}
            onPlace={placeOrder}
          />
        )}
        {view === 'paying' && (
          <section className="paying" data-testid="paying">
            <h2>⏳ Waiting for PayHover…</h2>
            <p>A new tab has opened to complete the payment. After you approve there, you'll come back here automatically.</p>
            <button onClick={() => setView('checkout')}>Cancel and choose another method</button>
          </section>
        )}
        {view === 'success' && orderId && (
          <Success
            orderId={orderId}
            paymentRef={paymentRef}
            method={method}
            total={total}
            email={address.name}
            onContinue={resetAll}
          />
        )}
      </main>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Views
// ──────────────────────────────────────────────────────────────────

function Browse({
  search, category, setCategory, onSelect, onAdd,
}: {
  search: string;
  category: Product['category'] | 'All';
  setCategory: (c: Product['category'] | 'All') => void;
  onSelect: (id: string) => void;
  onAdd: (id: string) => void;
}) {
  const filtered = PRODUCTS.filter(p => {
    if (category !== 'All' && p.category !== category) return false;
    if (search && !`${p.name} ${p.brand} ${p.description}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="layout-aside">
      <aside className="sidebar">
        <h3>Category</h3>
        <ul className="cat-list">
          <li>
            <button
              className={category === 'All' ? 'active' : ''}
              onClick={() => setCategory('All')}
              data-testid="cat-all"
            >
              All ({PRODUCTS.length})
            </button>
          </li>
          {CATEGORIES.map(c => {
            const n = PRODUCTS.filter(p => p.category === c).length;
            return (
              <li key={c}>
                <button
                  className={category === c ? 'active' : ''}
                  onClick={() => setCategory(c)}
                  data-testid={`cat-${c.toLowerCase()}`}
                >
                  {c} ({n})
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      <section className="grid" data-testid="product-grid">
        <h2>{search ? `Results for "${search}"` : category === 'All' ? 'All products' : category} · {filtered.length} item{filtered.length === 1 ? '' : 's'}</h2>
        {filtered.length === 0 ? (
          <p className="empty">No products match. Try a different search or category.</p>
        ) : (
          <ul className="cards">
            {filtered.map(p => (
              <li key={p.id} className="card" data-testid={`card-${p.id}`}>
                <button className="card-image" onClick={() => onSelect(p.id)} aria-label={`view ${p.name}`}>
                  <span>{p.emoji}</span>
                </button>
                <div className="card-body">
                  <button className="card-title" onClick={() => onSelect(p.id)}>{p.name}</button>
                  <div className="brand">by {p.brand}</div>
                  <div className="rating">
                    <span className="stars">{'★'.repeat(Math.round(p.rating))}</span>
                    <span className="rating-num">{p.rating}</span>
                    <span className="reviews">({p.reviewCount.toLocaleString()})</span>
                  </div>
                  <div className="price">{fmtPrice(p.price)}</div>
                  {p.prime && <div className="badge-prime">✓ Prime · free 2-day</div>}
                  <button
                    className="add-btn"
                    onClick={() => onAdd(p.id)}
                    aria-label={`add ${p.name} to cart`}
                    data-testid={`add-${p.id}`}
                  >
                    Add to cart
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ProductDetail({ product, onAdd, onBack }: { product: Product; onAdd: (qty: number) => void; onBack: () => void }) {
  const [qty, setQty] = useState(1);
  return (
    <article className="product-detail" data-testid="product-detail">
      <button className="link-back" onClick={onBack}>← Back to all products</button>
      <div className="product-row">
        <div className="product-image"><span>{product.emoji}</span></div>
        <div className="product-info">
          <div className="brand">by {product.brand}</div>
          <h1 data-testid="detail-name">{product.name}</h1>
          <div className="rating">
            <span className="stars">{'★'.repeat(Math.round(product.rating))}</span>
            <span className="rating-num">{product.rating}</span>
            <span className="reviews">({product.reviewCount.toLocaleString()} reviews)</span>
          </div>
          <div className="price-big" data-testid="detail-price">{fmtPrice(product.price)}</div>
          {product.prime && <div className="badge-prime">✓ Prime · free 2-day delivery</div>}
          <p className="desc">{product.description}</p>
          <div className="qty-row">
            <label>Qty
              <select value={qty} onChange={e => setQty(Number(e.target.value))} aria-label="quantity">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <button className="primary" onClick={() => onAdd(qty)} data-testid="detail-add">Add to cart</button>
          </div>
        </div>
      </div>
    </article>
  );
}

interface CartLineView extends CartItem { product: Product; lineTotal: number; }

function Cart({
  lines, subtotal, shipping, tax, total, updateQty, remove, onCheckout, onBack,
}: {
  lines: CartLineView[];
  subtotal: number; shipping: number; tax: number; total: number;
  updateQty: (id: string, qty: number) => void;
  remove: (id: string) => void;
  onCheckout: () => void;
  onBack: () => void;
}) {
  if (lines.length === 0) {
    return (
      <section className="cart empty" data-testid="cart-empty">
        <h1>Your cart is empty</h1>
        <button className="primary" onClick={onBack}>Continue shopping</button>
      </section>
    );
  }
  return (
    <section className="cart" data-testid="cart-view">
      <h1>Shopping cart</h1>
      <ul className="cart-lines">
        {lines.map(l => (
          <li key={l.id} className="cart-line" data-testid={`cart-line-${l.id}`}>
            <div className="line-image"><span>{l.product.emoji}</span></div>
            <div className="line-info">
              <h3>{l.product.name}</h3>
              <div className="brand">by {l.product.brand}</div>
              {l.product.prime && <div className="badge-prime sm">✓ Prime</div>}
              <div className="line-actions">
                <label>Qty
                  <select value={l.qty} onChange={e => updateQty(l.id, Number(e.target.value))} aria-label={`quantity for ${l.product.name}`}>
                    {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => <option key={n} value={n}>{n === 0 ? '0 (remove)' : n}</option>)}
                  </select>
                </label>
                <button className="link-danger" onClick={() => remove(l.id)} aria-label={`remove ${l.product.name}`}>Delete</button>
              </div>
            </div>
            <div className="line-price" data-testid={`cart-line-price-${l.id}`}>{fmtPrice(l.lineTotal)}</div>
          </li>
        ))}
      </ul>
      <CartTotals subtotal={subtotal} shipping={shipping} tax={tax} total={total} />
      <div className="cart-actions">
        <button onClick={onBack}>Keep shopping</button>
        <button className="primary" onClick={onCheckout} data-testid="proceed-to-checkout">
          Proceed to checkout
        </button>
      </div>
    </section>
  );
}

function CartTotals({ subtotal, shipping, tax, total }: { subtotal: number; shipping: number; tax: number; total: number }) {
  return (
    <dl className="totals" data-testid="totals">
      <div><dt>Subtotal</dt><dd>{fmtPrice(subtotal)}</dd></div>
      <div><dt>Shipping</dt><dd>{shipping === 0 ? <span className="free">FREE</span> : fmtPrice(shipping)}</dd></div>
      <div><dt>Estimated tax</dt><dd>{fmtPrice(tax)}</dd></div>
      <div className="grand"><dt>Order total</dt><dd data-testid="grand-total">{fmtPrice(total)}</dd></div>
    </dl>
  );
}

function Checkout({
  lines, subtotal, shipping, tax, total, address, setAddress,
  method, setMethod, card, setCard, providerError, onBack, onPlace,
}: {
  lines: CartLineView[];
  subtotal: number; shipping: number; tax: number; total: number;
  address: Address; setAddress: (a: Address) => void;
  method: PaymentMethod; setMethod: (m: PaymentMethod) => void;
  card: CardInfo; setCard: (c: CardInfo) => void;
  providerError: string | null;
  onBack: () => void; onPlace: () => void;
}) {
  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onPlace();
  }
  const addressOk = address.name.trim() && address.street.trim() && address.city.trim() && address.state.trim() && /^\d{5}$/.test(address.zip);
  const cardOk = method === 'external' || (card.number.length >= 12 && /^\d{2}\/\d{2}$/.test(card.expiry) && card.cvv.length >= 3);
  const formOk = addressOk && cardOk;

  return (
    <form className="checkout" onSubmit={handleSubmit}>
      <button type="button" className="link-back" onClick={onBack}>← Back to cart</button>
      <h1>Checkout</h1>

      <div className="checkout-grid">
        <div className="checkout-main">
          <section>
            <h2>1 · Shipping address</h2>
            <div className="grid-2">
              <label>Full name<input type="text" value={address.name} onChange={e => setAddress({ ...address, name: e.target.value })} aria-label="full name" /></label>
              <label>Street address<input type="text" value={address.street} onChange={e => setAddress({ ...address, street: e.target.value })} aria-label="street" /></label>
            </div>
            <div className="grid-3">
              <label>City<input type="text" value={address.city} onChange={e => setAddress({ ...address, city: e.target.value })} aria-label="city" /></label>
              <label>State<input type="text" value={address.state} onChange={e => setAddress({ ...address, state: e.target.value })} aria-label="state" maxLength={2} /></label>
              <label>ZIP<input type="text" value={address.zip} onChange={e => setAddress({ ...address, zip: e.target.value.replace(/\D/g, '') })} aria-label="zip" maxLength={5} /></label>
            </div>
          </section>

          <section>
            <h2>2 · Payment method</h2>
            <div className="method-radios" role="radiogroup" aria-label="payment method">
              <label className={`method-card ${method === 'card' ? 'selected' : ''}`}>
                <input type="radio" name="method" checked={method === 'card'} onChange={() => setMethod('card')} aria-label="payment method card" />
                <span className="method-title">💳 Credit / debit card</span>
                <span className="method-sub">Pay inline below</span>
              </label>
              <label className={`method-card ${method === 'external' ? 'selected' : ''}`}>
                <input type="radio" name="method" checked={method === 'external'} onChange={() => setMethod('external')} aria-label="payment method external" />
                <span className="method-title">🔒 PayHover</span>
                <span className="method-sub">Opens in a new tab</span>
              </label>
            </div>

            {method === 'card' && (
              <div className="reveal">
                <label>Card number
                  <input type="text" inputMode="numeric" maxLength={19}
                    value={card.number}
                    onChange={e => setCard({ ...card, number: e.target.value.replace(/\D/g, '') })}
                    placeholder="1234 5678 9012 3456" aria-label="card number" />
                </label>
                <div className="grid-2">
                  <label>Expiry (MM/YY)
                    <input type="text" maxLength={5}
                      value={card.expiry}
                      onChange={e => setCard({ ...card, expiry: e.target.value })}
                      placeholder="12/27" aria-label="expiry" />
                  </label>
                  <label>CVV
                    <input type="text" maxLength={4}
                      value={card.cvv}
                      onChange={e => setCard({ ...card, cvv: e.target.value.replace(/\D/g, '') })}
                      aria-label="cvv" />
                  </label>
                </div>
              </div>
            )}
            {method === 'external' && (
              <p className="muted">
                Clicking "Place order" will open PayHover in a new tab. Approve there
                and the order completes automatically. The popup will close itself.
              </p>
            )}
            {providerError && <p className="form-error" data-testid="provider-error">{providerError}</p>}
          </section>
        </div>

        <aside className="checkout-summary">
          <h2>Order summary</h2>
          <ul className="summary-lines">
            {lines.map(l => (
              <li key={l.id}>
                <span className="qty">{l.qty}×</span>
                <span className="name">{l.product.name}</span>
                <span className="lp">{fmtPrice(l.lineTotal)}</span>
              </li>
            ))}
          </ul>
          <CartTotals subtotal={subtotal} shipping={shipping} tax={tax} total={total} />
          <button
            type="submit"
            className="primary"
            disabled={!formOk}
            data-testid="place-order"
          >
            Place order · {fmtPrice(total)}
          </button>
        </aside>
      </div>
    </form>
  );
}

function Success({
  orderId, paymentRef, method, total, email, onContinue,
}: {
  orderId: string;
  paymentRef: string | null;
  method: PaymentMethod;
  total: number;
  email: string;
  onContinue: () => void;
}) {
  return (
    <section className="success" data-testid="success">
      <h1>✓ Order placed</h1>
      <p>Order <code data-testid="order-id">{orderId}</code> · {fmtPrice(total)}</p>
      <p>Payment via <strong>{method === 'external' ? 'PayHover' : 'card'}</strong>
        {paymentRef && <> · ref <code>{paymentRef}</code></>}.</p>
      <p className="muted">
        Confirmation sent to <strong>{email || '(no email on file)'}</strong>. Expect
        delivery in 2 business days for Prime items.
      </p>
      <button className="primary" onClick={onContinue}>Keep shopping</button>
    </section>
  );
}
