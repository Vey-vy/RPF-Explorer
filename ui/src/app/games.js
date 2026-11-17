import {LogicalSize} from '@tauri-apps/api/dpi';

export const games = [
  {
    id: 'max-payne-3',
    name: 'Max Payne 3',
    image: 'https://cdn.veyvy.space/data/scdb/screen/mp3.jpg'
  },
  {
    id: 'gta-iv',
    name: 'GTA IV',
    image: 'https://cdn.veyvy.space/data/scdb/screen/gtaiv.jpg'
  },
  {
    id: 'gta-v',
    name: 'GTA V',
    image: 'https://cdn.veyvy.space/data/scdb/screen/gtav_enhanced.jpg'
  },
  {
    id: 'rdr1',
    name: 'Red Dead Redemption',
    image: 'https://cdn.veyvy.space/data/scdb/screen/rdr.jpeg'
  },
  {
    id: 'rdr2',
    name: 'Red Dead Redemption 2',
    image: 'https://cdn.veyvy.space/data/scdb/screen/rdr2.jpg'
  },
];

export const windowSizes = {
  menu: new LogicalSize(1100, 500),
  explorer: new LogicalSize(1280, 820),
};
