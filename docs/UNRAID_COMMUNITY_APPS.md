# Publish Gym App to Unraid Community Apps

This checklist is for publishing Gym App so users can find it in Unraid Community Applications.

## 1. Publish the Docker image

This repository builds and pushes the image with GitHub Actions:

- Workflow: `.github/workflows/docker.yml`
- Image: `ghcr.io/thaihoang987/gym-app`
- Default tag: `latest`
- Commit tag: `sha-<commit>`
- Release tags: `0.3.47`, `0.3`, etc. when pushing Git tags like `v0.3.47`

After the workflow runs, open the package page on GitHub and set the package visibility to **Public**:

```text
https://github.com/thaihoang987?tab=packages
```

If the package is private, Unraid users cannot pull the image unless they log in to GHCR manually.

## 2. Create a stable release tag

Use a version tag when you want to publish a stable image:

```powershell
git tag v0.3.47
git push origin v0.3.47
```

The workflow will publish:

```text
ghcr.io/thaihoang987/gym-app:0.3.47
ghcr.io/thaihoang987/gym-app:0.3
```

The Unraid template can keep using `latest`, or you can pin it to a stable version tag if you want slower updates.

## 3. Validate the Unraid template

Template file:

```text
unraid-template.xml
```

Important fields:

- `Repository`: `ghcr.io/thaihoang987/gym-app:latest`
- `WebUI`: `http://[IP]:[PORT:3001]/`
- `/app/data`: persistent appdata folder
- `ADMIN_PASSWORD`: used only when the database is first created
- `TZ`: timezone

Install manually once on your own Unraid server before submitting:

1. Open Unraid Docker tab.
2. Add Container.
3. Use the template XML or fill the same values manually.
4. Confirm the app opens at `http://SERVER_IP:3001`.
5. Confirm data persists after container restart.

## 4. Create a support link

Community Apps works best with a support topic on the Unraid forum.

Current template support URL:

```text
https://github.com/thaihoang987/Gym-app/issues
```

Recommended:

1. Create a support topic on the Unraid forum.
2. Replace the `<Support>` URL in `unraid-template.xml`.
3. Commit and push the template update.

## 5. Submit to Community Apps

Submit here:

```text
https://ca.unraid.net/submit
```

Use the repository URL:

```text
https://github.com/thaihoang987/Gym-app
```

Then run the CA submission flow:

1. Validate the repository/template.
2. Scan the repository.
3. Fix any reported template or metadata issues.
4. Submit for review.

Official references:

- https://docs.unraid.net/community-applications/
- https://ca.unraid.net/submit/help/repository-xml
- https://ca.unraid.net/submit/help/xml-field-reference

## 6. License and dataset note

Gym App uses the `hasaneyldrm/exercises-dataset` exercise data/media during Docker image build.

That dataset is described by its author as educational and non-commercial. Exercise images/GIFs may belong to their respective owners. Keep this notice visible when publishing the app publicly, and replace the bundled dataset/media before any commercial distribution.

