// Wrapper attribution lab — exercises the wrapper patterns the v0.4.x
// "Suggest fix prompt" picker has to handle. Each section renders an
// interactive element via a different composition style; the test harness
// reads the DOM and records what data-hover-source actually points to.
//
// Findings (React 19 + Vite + @vitejs/plugin-react, 2026-05-25):
//
//   A bare <button>          → data-hover-source = the button's JSX line ✅
//   B styled.button          → data-hover-source = MISSING — styled-components
//                              creates the host element inside its own library
//                              code, which our transform does not visit.
//   C className-forwarding   → data-hover-source = wrapper-internal <button>,
//                              NOT the user's <ShadcnButton> call site.
//   D multi-layer nested     → same shape as C — points to the innermost
//                              wrapper's <button>, not Card / CardBody / call.
//   E Radix Slot / asChild   → data-hover-source = the user-passed <a> child ✅
//                              (Slot does not render its own host; it clones
//                              the child, so the child's stamp survives.)
//
// React 19 fiber inspection:
//   _debugSource is GONE on every fiber (confirms facebook/react#28265).
//   _debugOwner is STILL present — gives a chain of component *names*
//   (NestedButton → CardBody → Card → CaseD) but no source locations.
//
// Product implication for the Suggest-fix prompt:
//   The selected element's own data-hover-source is necessary but not
//   sufficient. The picker should also send (a) the DOM ancestor chain of
//   data-hover-source attributes — for cases C/D this is the path back to
//   the user's call site — and (b) the React owner-name chain from
//   _debugOwner, so the agent can grep the repo when the stamp lands inside
//   a wrapper. Case B (styled-components) has neither a useful stamp nor a
//   useful owner — fallback to outerHTML + className for those.
//
// Sections labelled data-lab="<case>" so the verifier can find them.

import styled from 'styled-components';
import { Slot } from '@radix-ui/react-slot';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';

// --- Case A: bare host element (control) ---
function CaseA() {
  return (
    <div data-lab="A-bare">
      <button className="btn-primary">A: bare button</button>
    </div>
  );
}

// --- Case B: styled-components ---
const StyledButton = styled.button`
  background: tomato;
  color: white;
  border: 0;
  padding: 6px 12px;
  border-radius: 4px;
`;
function CaseB() {
  return (
    <div data-lab="B-styled">
      <StyledButton>B: styled-components button</StyledButton>
    </div>
  );
}

// --- Case C: className-forwarding shadcn-style wrapper ---
function ShadcnButton({ className = '', ...rest }: ComponentPropsWithoutRef<'button'>) {
  return <button className={`btn-primary ${className}`} {...rest} />;
}
function CaseC() {
  return (
    <div data-lab="C-shadcn">
      <ShadcnButton>C: shadcn-style wrapper</ShadcnButton>
    </div>
  );
}

// --- Case D: multi-layer wrapper chain ---
function Card({ children }: { children: ReactNode }) {
  return <div className="lab-card">{children}</div>;
}
function CardBody({ children }: { children: ReactNode }) {
  return <div className="lab-card-body">{children}</div>;
}
function NestedButton(props: ComponentPropsWithoutRef<'button'>) {
  return <button className="btn-primary" {...props} />;
}
function CaseD() {
  return (
    <div data-lab="D-nested">
      <Card>
        <CardBody>
          <NestedButton>D: 3-layer nested</NestedButton>
        </CardBody>
      </Card>
    </div>
  );
}

// --- Case E: Radix-style Slot / asChild ---
// SlotButton renders *into* its child instead of emitting its own DOM node,
// so the rendered host element comes from whatever the caller passed in.
function SlotButton({ asChild, children, ...rest }: ComponentPropsWithoutRef<'button'> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'button';
  return <Comp className="btn-primary" {...rest}>{children}</Comp>;
}
function CaseE() {
  return (
    <div data-lab="E-asChild">
      <SlotButton asChild>
        <a href="#lab">E: rendered as anchor via asChild</a>
      </SlotButton>
    </div>
  );
}

export function WrapperLab() {
  return (
    <section className="panel" aria-labelledby="lab-heading" data-lab="root">
      <header className="panel-head">
        <span className="panel-no">04</span>
        <h2 id="lab-heading">Wrapper attribution lab</h2>
        <span className="panel-state mono">5 cases</span>
      </header>
      <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <CaseA />
        <CaseB />
        <CaseC />
        <CaseD />
        <CaseE />
      </div>
    </section>
  );
}
