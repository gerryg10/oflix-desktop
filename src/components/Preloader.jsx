import { useEffect, useState } from 'react';

export default function Preloader({ onDone }) {
  const [fading, setFading] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setFading(true);
      setTimeout(onDone, 500);
    }, 1200);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      id="preloader"
      style={{
        opacity: fading ? 0 : 1,
        pointerEvents: fading ? 'none' : 'auto',
      }}
    >
      <img src="/logo.png" alt="OFLIX" />
    </div>
  );
}
