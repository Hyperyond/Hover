export default function Page() {
  return (
    <main style={{ maxWidth: 480, margin: '60px auto', padding: 24 }}>
      <h1>turbo-monorepo / game</h1>
      <p>
        Second workspace, intentionally NOT wired to Hover — exists so
        running <code>npx @hover-dev/cli setup</code> at the repo root
        triggers the interactive multi-workspace picker.
      </p>
    </main>
  );
}
