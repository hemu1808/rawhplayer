export interface RadioStation {
  id: string;
  name: string;
  url: string;
  genre: string;
  description: string;
  logo?: string;
}

export const RADIO_STATIONS: RadioStation[] = [
  {
    id: 'somafm-groovesalad',
    name: 'SomaFM Groove Salad',
    url: 'https://ice1.somafm.com/groovesalad-256-mp3',
    genre: 'Ambient',
    description: 'A nicely chilled plate of ambient/downtempo beats and grooves.',
  },
  {
    id: 'radioparadise-main',
    name: 'Radio Paradise',
    url: 'https://stream.radioparadise.com/flac',
    genre: 'Eclectic',
    description: 'Eclectic mix of rock, pop, electronica, world music & more.',
  },
  {
    id: 'somafm-dronezone',
    name: 'SomaFM Drone Zone',
    url: 'https://ice1.somafm.com/dronezone-256-mp3',
    genre: 'Ambient',
    description: 'Served best chilled, safe with most medications. Atmospheric textures with minimal beats.',
  },
  {
    id: 'kexp',
    name: 'KEXP Seattle',
    url: 'https://kexp-mp3-128.streamguys1.com/kexp128.mp3',
    genre: 'Indie',
    description: 'Where the music matters. Eclectic mix of indie rock, electronic, hip-hop, and more.',
  },
  {
    id: 'jazzradio',
    name: 'Jazz Radio',
    url: 'http://jazz128.icecast.radiotunes.com/jazz_lofi',
    genre: 'Jazz',
    description: 'Classic and modern jazz.',
  },
  {
    id: 'chilltrax',
    name: 'Chilltrax',
    url: 'http://ice.somafm.com/groovesalad',
    genre: 'Electronic',
    description: "The world's chillout channel.",
  },
  {
    id: 'classical',
    name: 'Classical WQXR',
    url: 'https://stream.wqxr.org/wqxr',
    genre: 'Classical',
    description: "New York's Classical Music Radio.",
  },
  {
    id: 'di-vocaltrance',
    name: 'DI.FM Vocal Trance',
    url: 'http://prem1.di.fm:80/vocaltrance',
    genre: 'Electronic',
    description: 'Uplifting vocals over progressive and trance beats.',
  },
  {
    id: 'lofi',
    name: 'Lofi Girl',
    url: 'https://play.streamafrica.net/lofiradio',
    genre: 'Lo-Fi',
    description: 'Beats to relax/study to.',
  },
  {
    id: 'bbc6',
    name: 'BBC Radio 6 Music',
    url: 'http://stream.live.vc.bbcmedia.co.uk/bbc_6music',
    genre: 'Alternative',
    description: 'Alternative music spanning from the 60s to today.',
  },
];

export const getStations = (): RadioStation[] => {
  return RADIO_STATIONS;
};
