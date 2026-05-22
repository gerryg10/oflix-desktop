import fs from 'fs';

const seasonData = [
  { s: 1, eps: 18 },
  { s: 2, eps: 18 },
  { s: 3, eps: 20 },
  { s: 4, eps: 20 },
  { s: 5, eps: 18 },
  { s: 6, eps: 22 },
  { s: 7, eps: 10 }
];

const seasons = seasonData.map(sd => {
  const episodes = [];
  for (let i = 1; i <= sd.eps; i++) {
    episodes.push({
      episode: i,
      title: `Episode ${i}`,
      video_url: `https://202-155-18-146.nevacloud.net/video/good_doctor_s${sd.s}e${i}/master.m3u8`
    });
  }
  return {
    season: sd.s,
    episodes: episodes
  };
});

const seriesData = [
  {
    id: "the_good_doctor",
    title: "The Good Doctor (2017)",
    poster: "https://202-155-18-146.nevacloud.net/poster/good_doctor.jpg",
    year: "2017", // Optional 
    rating: "8.1", // Optional
    genre: ["Drama", "Medical"], // Optional
    type: "series", // Required
    country: "United States", // Optional
    duration: "43m", // Optional
    trailerUrl: "https://202-155-18-146.nevacloud.net/trailer/good_doctor.mp4",
    description: "The Good Doctor adalah serial drama medis Amerika Serikat yang berfokus pada Shaun Murphy, seorang ahli bedah muda dengan autisme dan sindrom savant di rumah sakit bergengsi San Jose St. Bonaventure.",
    seasons: seasons
  }
];

fs.writeFileSync('d:/Coding/Oflix/backend/custom_oflix.json', JSON.stringify(seriesData, null, 2));
console.log('JSON berhasil dibuat!');
