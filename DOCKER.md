# Docker Runbook

This compose setup starts the web server and an NVIDIA GPU speech-transcription service. The Windows PyQt management window and host serial-device access are not available inside the container.

## First run

1. Create a `.env` file beside `compose.yaml` with host directories. Use forward slashes on Windows:

   ```ini
   YFS_DATA_DIR=F:/Work/YFS/data
   YFS_ROOT_DIR=F:/Work
   YFS_LOG_DIR=F:/Work/YobboyFileServer/logs
   YFS_PORT=5001
   YFS_HTTPS_PORT=5002
   YFS_SPEECH_MODELS_DIR=C:/Users/YourName/.cache/modelscope/models
   ```

   `YFS_DATA_DIR` must point to the existing data directory to retain the current game database at `games/game_hub.sqlite3`.

2. Change the login and admin passwords in `docker/config.ini` before exposing the server to a LAN. The GPU speech service requires Docker Desktop NVIDIA GPU support and the three cached ModelScope model folders.

3. Build and run:

   ```powershell
   docker compose up --build
   ```

   Open `http://localhost:5001`.

## Daily use

Use `docker compose up`. The project directory is mounted into `/app`, so Python, template, and static-file changes do not require an EXE build or a Docker image rebuild. Re-run `docker compose build` only after changing `requirements.txt` or `Dockerfile`.

Do not use `docker compose down -v`: that removes Docker-managed volumes. With the host-path configuration above, application data is a host directory and remains intact.

## HTTPS settings

Open `/docker-settings` after logging in. Enter the administrator password to enable HTTPS or change its port; the default is `5002`. The page synchronizes `YFS_HTTPS_PORT` in `.env`; run `docker compose up -d --force-recreate` after saving.
