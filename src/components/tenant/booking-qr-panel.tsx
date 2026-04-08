type BookingQrPanelProps = {
  tenantId: string;
  tenantName: string;
  bookingUrl: string;
  heading?: string;
  copy?: string;
};

export function BookingQrPanel({
  tenantId,
  tenantName,
  bookingUrl,
  heading = 'Booking QR code',
  copy = 'Admins can download and print this QR code so customers can scan straight to the booking page.',
}: BookingQrPanelProps) {
  const qrBaseHref = `/api/v1/admin/tenants/${tenantId}/booking-qr`;

  return (
    <section className="panel qr-card">
      <div className="panel-header">
        <div>
          <h2>{heading}</h2>
          <p className="panel-copy">{copy}</p>
        </div>
      </div>

      <div className="qr-card-grid">
        <div className="qr-preview">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`${qrBaseHref}?format=svg`}
            alt={`${tenantName} booking QR code`}
            className="qr-preview-image"
            loading="lazy"
          />
        </div>

        <div className="stack">
          <div className="panel" style={{ padding: 18 }}>
            <strong>{tenantName}</strong>
            <div className="eyebrow" style={{ marginTop: 6 }}>
              {bookingUrl}
            </div>
          </div>

          <div className="hero-actions">
            <a href={bookingUrl} className="button" target="_blank" rel="noreferrer">
              Open booking page
            </a>
            <a href={`${qrBaseHref}?format=svg&download=1`} className="button secondary">
              Download SVG
            </a>
            <a href={`${qrBaseHref}?format=png&download=1`} className="button secondary">
              Download PNG
            </a>
          </div>

          <p className="note">
            Print this near reception, on the mirror, or at the waiting area so customers can book with one scan. Staff cannot generate this code.
          </p>
        </div>
      </div>
    </section>
  );
}
