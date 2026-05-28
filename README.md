# Gym App

Gym App is a local-first workout tracker for personal or family use. It includes an exercise library with local JPG/GIF media, group/routine builders, workout logging, body-weight tracking, and basic analytics.

## Local development

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

Build and run:

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

- `hasaneyldrm-exercises-dataset/data/exercises.json`: 1,324 exercises
- `hasaneyldrm-exercises-dataset/images`: JPG thumbnails
- `hasaneyldrm-exercises-dataset/videos`: GIF animations

The library list renders lightweight JPG cards in batches. GIF files are loaded only when opening exercise detail or entering workout mode.

## Notes

- Build output is generated into `dist`.
- `node_modules` and runtime database files are ignored for Docker/Git usage.
- The Dockerfile builds the frontend and serves the production app through the Express server on port `3001`.
