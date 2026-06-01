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

## Update flow

This repo is structured so updates can be pulled and rebuilt without touching user data:

```powershell
git pull
docker compose up -d --build
```

The app keeps persistent workout data in `./data`, which is mounted into the container. Do not commit `data/*.sqlite*` to GitHub.

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
