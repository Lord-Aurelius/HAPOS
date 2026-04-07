export default function CustomerLoading() {
  return (
    <div className="route-loading">
      <section className="loading-card">
        <div className="loading-line is-short" />
        <div className="loading-line is-title" />
        <div className="loading-line is-medium" />
      </section>

      <section className="loading-grid">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="loading-card">
            <div className="loading-line is-short" />
            <div className="loading-line is-title" />
          </div>
        ))}
      </section>
    </div>
  );
}
