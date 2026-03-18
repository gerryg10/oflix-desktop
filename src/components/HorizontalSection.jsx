import { useNavigate } from 'react-router-dom';
import MovieCard from './MovieCard.jsx';

export default function HorizontalSection({ title, items, seeMorePath, onCardClick }) {
  const nav = useNavigate();

  return (
    <section className="h-section fade-up">
      <div className="h-section-header">
        <h2 className="h-section-title">{title}</h2>
        {seeMorePath && (
          <button className="see-more-btn" onClick={() => nav(seeMorePath)}>
            Lihat &rsaquo;
          </button>
        )}
      </div>
      <div className="h-scroll">
        {items.map((item, i) => (
          <MovieCard key={i} item={item} onClick={onCardClick} />
        ))}
      </div>
    </section>
  );
}
