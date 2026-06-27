export function CodePanel({ code }: { code: string }) {
  return (
    <section className="code-panel">
      <div className="code-head">Generated CrewAI code (live)</div>
      <pre className="code">{code}</pre>
    </section>
  );
}
