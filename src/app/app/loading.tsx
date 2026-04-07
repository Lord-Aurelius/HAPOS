export default function AppLoading() {
  return (
    <div className="route-loading">
      <section className="loading-card">
        <div className="loading-line is-short" />
        <div className="loading-line is-title" />
        <div className="loading-line is-medium" />
      </section>

      <section className="loading-grid">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="loading-card">
            <div className="loading-line is-short" />
            <div className="loading-line is-title" />
          </div>
        ))}
      </section>

      <section className="loading-grid">
        {Array.from({ length: 2 }).map((_, index) => (
          <div key={index} className="loading-card">
            <div className="loading-line is-medium" />
            <div className="loading-line is-title" />
            <div className="loading-line" />
            <div className="loading-line is-medium" />
          </div>
        ))}
      </section>
    </div>
  );
}
