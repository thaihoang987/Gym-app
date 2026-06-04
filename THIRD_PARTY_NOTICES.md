# Third-Party Notices

Gym App uses open-source libraries and an external exercise dataset. This file summarizes the main third-party components used by the application. Full license text for npm packages is available in each package published to npm and in `node_modules` after installation.

## Application Dependencies

| Component | License | Source |
|---|---|---|
| React | MIT | https://github.com/facebook/react |
| React DOM | MIT | https://github.com/facebook/react |
| Vite | MIT | https://github.com/vitejs/vite |
| @vitejs/plugin-react | MIT | https://github.com/vitejs/vite-plugin-react |
| Express | MIT | https://github.com/expressjs/express |
| CORS | MIT | https://github.com/expressjs/cors |
| better-sqlite3 | MIT | https://github.com/WiseLibs/better-sqlite3 |
| Recharts | MIT | https://github.com/recharts/recharts |
| lucide-react | ISC | https://github.com/lucide-icons/lucide |
| dnd kit (`@dnd-kit/*`) | MIT | https://github.com/clauderic/dnd-kit |
| @ncdai/react-wheel-picker | MIT | https://github.com/ncdai/react-wheel-picker |
| react-native-body-highlighter SVG path data | MIT | https://github.com/HichamELBSI/react-native-body-highlighter |
| ExcelJS | MIT | https://github.com/exceljs/exceljs |
| Tailwind CSS | MIT | https://github.com/tailwindlabs/tailwindcss |
| PostCSS | MIT | https://github.com/postcss/postcss |
| Autoprefixer | MIT | https://github.com/postcss/autoprefixer |
| vite-plugin-pwa | MIT | https://github.com/vite-pwa/vite-plugin-pwa |
| Workbox packages | MIT | https://github.com/GoogleChrome/workbox |
| concurrently | MIT | https://github.com/open-cli-tools/concurrently |

Most transitive npm dependencies use permissive licenses such as MIT, ISC, BSD, Apache-2.0, 0BSD, BlueOak-1.0.0, CC0-1.0, or Unlicense. Check `package-lock.json` and installed package metadata for the exact dependency tree used by a given build.

## Exercise Dataset

This repository may include or reference:

- `hasaneyldrm-exercises-dataset/data/exercises.json`
- `hasaneyldrm-exercises-dataset/images`
- `hasaneyldrm-exercises-dataset/videos`

Source: https://github.com/hasaneyldrm/exercises-dataset

Important license notes from the dataset README:

- The dataset is provided for educational and non-commercial research purposes only.
- Commercial use is prohibited by the dataset author.
- Exercise images and videos belong to their respective copyright holders.
- Copyright owners should contact the dataset owner for removal requests.

Gym App does not claim ownership of that dataset, its images, or its videos. Users who build or run Gym App with this bundled dataset are responsible for complying with the dataset's terms and any applicable third-party media rights.

For public or commercial distribution, replace the bundled exercise media with content that has a clear license allowing that use, or require users to download/import their own exercise media separately.

