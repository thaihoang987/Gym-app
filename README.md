# Gym App

Gym App is a local-first workout tracker for personal or family use. It includes an exercise library with local JPG/GIF media, group/routine builders, workout logging, body-weight tracking, and basic analytics.

## Local development

Prerequisites:

- Node.js 22+
- npm
- Internet access for the first dataset download

Clone the exercise dataset before the first local run:

```powershell
git clone --depth 1 https://github.com/hasaneyldrm/exercises-dataset.git hasaneyldrm-exercises-dataset
```

Then install dependencies and start the app:

```powershell
npm install
npm run dev
```

- Web: `http://localhost:5173`
- API: `http://localhost:3001`

Default login:

- Username: `admin`
- Password: `admin123`

## Docker / Unraid

Prerequisites:

- Docker / Docker Compose
- Internet access during the first image build. The Dockerfile downloads the exercise dataset and bundles it into the image.

You do not need to download the exercise dataset manually for Docker/Unraid. The Dockerfile downloads and bundles it during image build.

Build and run from the repo folder:

```powershell
docker compose up -d --build
```

Production URL:

- `http://SERVER_IP:3001`

Persistent data:

- SQLite database: `./data/gym.sqlite`
- Container path: `/app/data`

For Unraid, map an appdata folder to `/app/data`, for example:

```yaml
volumes:
  - /mnt/user/appdata/gym-app:/app/data
```

Recommended Unraid container settings:

| Setting | Value |
|---|---|
| Repository | `ghcr.io/thaihoang987/gym-app:latest` if you publish an image, or build from this repo with Docker Compose |
| WebUI | `http://[IP]:[PORT:3001]/` |
| Network | `bridge` |
| Web Port | Container `3001` to host `3001` |
| Appdata path | `/mnt/user/appdata/gym-app/data` mapped to `/app/data` |
| Restart policy | `unless-stopped` |
| Default username | `admin` |
| Default password | `admin123`, or the `ADMIN_PASSWORD` variable on a fresh database |

Files to back up:

- `/mnt/user/appdata/gym-app/data/gym.sqlite`
- `/mnt/user/appdata/gym-app/data/uploads`
- `/mnt/user/appdata/gym-app/data/exercise-translations` if you add custom translations

Server logs are written to:

- `/mnt/user/appdata/gym-app/data/logs/server.log`

This repo also includes `unraid-template.xml` for Community Applications/manual template use.

## Update flow

This repo is structured so updates can be pulled and rebuilt without touching user data:

```powershell
git pull
docker compose up -d --build
```

The app keeps persistent workout data in `./data`, which is mounted into the container. Do not commit `data/*.sqlite*` to GitHub.

## Install on phone

Gym App includes PWA support, so it can be installed to the home screen on phones and tablets.

Android Chrome:

1. Open `http://SERVER_IP:3001`.
2. Open the browser menu.
3. Tap **Install app** or **Add to Home screen**.

iPhone / iPad Safari:

1. Open `http://SERVER_IP:3001`.
2. Tap the Share button.
3. Tap **Add to Home Screen**.

Notes:

- iOS and Android must be on the same network as the server unless you expose the app through a reverse proxy/VPN.
- Browser notification behavior is limited on iOS/Android and depends on browser permissions.
- PWA install works best over HTTPS. Local LAN HTTP can still be opened in the browser, but some PWA features may be limited.

## Included dataset

Gym App uses `hasaneyldrm/exercises-dataset` for the default exercise library:

- `hasaneyldrm-exercises-dataset/data/exercises.json`: 1,324 exercises
- `hasaneyldrm-exercises-dataset/images`: JPG thumbnails
- `hasaneyldrm-exercises-dataset/videos`: GIF animations

The dataset folder is not committed to this repo. For Docker builds, it is downloaded during image build. For local development, clone it manually with the command in the Local development section.

The library list renders lightweight JPG cards in batches. GIF files are loaded only when opening exercise detail or entering workout mode.

The bundled exercise dataset is for personal, educational, and non-commercial use according to the dataset README. Exercise images and GIFs may belong to their respective copyright holders. See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) before redistributing this repo or Docker image publicly.

## Third-party licenses

Gym App uses third-party open-source modules such as React, Vite, Express, dnd kit, react-wheel-picker, Recharts, lucide-react, Tailwind CSS, and others. See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) for license and attribution details.

## Donate

Gym App is free for personal use. If it helps you, you can optionally support development and maintenance:

- Ko-fi: https://ko-fi.com/leonbell
- PayPal: https://paypal.me/leonbell95

Donations are voluntary and do not purchase a license to any third-party exercise dataset, images, or GIFs bundled with or referenced by this project.

## Notes

- Build output is generated into `dist`.
- `node_modules` and runtime database files are ignored for Docker/Git usage.
- The Dockerfile builds the frontend and serves the production app through the Express server on port `3001`.
