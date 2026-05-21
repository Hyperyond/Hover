// Hardcoded product catalog. Mock Amazon-style line-up across a few
// categories so search/filter has something to chew on.

export interface Product {
  id: string;
  name: string;
  brand: string;
  category: 'Electronics' | 'Home' | 'Kitchen' | 'Office' | 'Beauty' | 'Fitness';
  price: number;
  emoji: string;
  description: string;
  rating: number;
  reviewCount: number;
  prime: boolean;
}

export const PRODUCTS: Product[] = [
  {
    id: 'echo-dot-5', name: 'Echo Dot (5th Gen)', brand: 'Amazon',
    category: 'Electronics', price: 49.99, emoji: '🔊',
    description: 'Compact smart speaker with Alexa. Improved sound, room-aware EQ.',
    rating: 4.6, reviewCount: 128342, prime: true,
  },
  {
    id: 'mx-master', name: 'MX Master 3S Wireless Mouse', brand: 'Logitech',
    category: 'Office', price: 99.99, emoji: '🖱️',
    description: 'Ergonomic mouse with quiet clicks and MagSpeed scroll wheel.',
    rating: 4.8, reviewCount: 24211, prime: true,
  },
  {
    id: 'flexispot-desk', name: 'FlexiSpot E7 Pro Standing Desk', brand: 'FlexiSpot',
    category: 'Office', price: 449.00, emoji: '🖥️',
    description: '48×30" electric sit-stand desk, dual motor, 4 memory presets.',
    rating: 4.5, reviewCount: 9210, prime: false,
  },
  {
    id: 'bambino-plus', name: 'Bambino Plus Espresso Machine', brand: 'Breville',
    category: 'Kitchen', price: 499.99, emoji: '☕',
    description: 'Compact home espresso machine with auto milk frother.',
    rating: 4.7, reviewCount: 15621, prime: true,
  },
  {
    id: 'keychron-k2', name: 'K2 Pro Mechanical Keyboard', brand: 'Keychron',
    category: 'Office', price: 129.99, emoji: '⌨️',
    description: '75% layout, hot-swappable switches, QMK/VIA programmable.',
    rating: 4.6, reviewCount: 6103, prime: true,
  },
  {
    id: 'eltamd-spf', name: 'UV Clear Broad-Spectrum SPF 46', brand: 'EltaMD',
    category: 'Beauty', price: 41.00, emoji: '🌞',
    description: 'Daily mineral face sunscreen, fragrance-free.',
    rating: 4.7, reviewCount: 38234, prime: true,
  },
  {
    id: 'manduka-pro', name: 'PRO Yoga Mat — 6mm', brand: 'Manduka',
    category: 'Fitness', price: 138.00, emoji: '🧘',
    description: 'Premium high-density yoga mat. Lifetime guarantee.',
    rating: 4.8, reviewCount: 16543, prime: false,
  },
  {
    id: 'hue-color', name: 'Hue White & Color Smart Bulb (A19)', brand: 'Philips',
    category: 'Home', price: 49.99, emoji: '💡',
    description: 'Voice-controllable color-changing LED bulb. Hub required.',
    rating: 4.5, reviewCount: 49876, prime: true,
  },
  {
    id: 'kindle-paperwhite', name: 'Kindle Paperwhite (11th Gen)', brand: 'Amazon',
    category: 'Electronics', price: 159.99, emoji: '📖',
    description: '6.8" 300ppi glare-free display. Waterproof. 10-week battery.',
    rating: 4.7, reviewCount: 87421, prime: true,
  },
  {
    id: 'instant-pot', name: 'Instant Pot Duo Plus 6Qt', brand: 'Instant',
    category: 'Kitchen', price: 119.99, emoji: '🍲',
    description: '9-in-1 pressure / slow / rice / steam / yogurt cooker.',
    rating: 4.7, reviewCount: 142003, prime: true,
  },
  {
    id: 'noise-cancel', name: 'WH-1000XM5 Noise Cancelling Headphones', brand: 'Sony',
    category: 'Electronics', price: 399.99, emoji: '🎧',
    description: 'Industry-leading noise cancellation, 30hr battery, LDAC.',
    rating: 4.6, reviewCount: 28435, prime: true,
  },
  {
    id: 'water-bottle', name: 'Hydro Flask 32oz Wide Mouth', brand: 'Hydro Flask',
    category: 'Fitness', price: 44.95, emoji: '💧',
    description: 'Vacuum insulated stainless. Keeps cold 24h / hot 12h.',
    rating: 4.8, reviewCount: 22118, prime: true,
  },
];

export const CATEGORIES: Product['category'][] = ['Electronics', 'Home', 'Kitchen', 'Office', 'Beauty', 'Fitness'];

export function fmtPrice(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}
