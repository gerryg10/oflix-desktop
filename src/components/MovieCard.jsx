

export default function MovieCard({ item, onClick, style }) {
  const poster = (item.poster || item.thumbnail || item.image || '');

  return (
    <div className="movie-card" style={style} onClick={() => onClick?.(item)}>
      {item.badge && (
        <span className={`card-badge ${item.badge === 'BARU' ? 'new' : item.badge === 'TOP' ? 'top' : ''}`}>
          {item.badge}
        </span>
      )}
      {poster ? (
        <img
          src={poster}
          alt={item.title || item.name || ''}
          loading="lazy"
          onError={e => {
            e.target.style.display = 'none';
            e.target.nextSibling && (e.target.nextSibling.style.display = 'flex');
          }}
        />
      ) : null}
      {/* Fallback placeholder */}
      <div className="card-img-fallback" style={{ display: poster ? 'none' : 'flex' }}>
        <i className="fas fa-film" style={{ fontSize: 28, color: '#333' }}></i>
      </div>
      <div className="card-label">{item.title || item.name}</div>
    </div>
  );
}
