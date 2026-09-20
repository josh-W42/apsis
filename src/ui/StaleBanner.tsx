export function StaleBanner({ generatedAt }: { generatedAt: string }) {
  return (
    <div
      role="status"
      style={{
        position: 'absolute', top: 0, left: 0, right: 0,
        padding: '8px 16px', textAlign: 'center',
        background: '#4a3a12', color: '#ffd98a',
        font: '13px system-ui', zIndex: 10,
      }}
    >
      Orbital elements were last refreshed {new Date(generatedAt).toUTCString()}.
      Positions may have drifted.
    </div>
  );
}
