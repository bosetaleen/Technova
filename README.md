# Public Reporting Portal (Minimal Stack)

**Stack**: HTML/CSS/JS + Node.js (Express + EJS) + MySQL + REST API

## 1) Prerequisites
- Node.js 18+ and npm
- MySQL 8+ running locally
- Create a database user with privileges (or reuse root for local dev only).

## 2) Get the Code
```bash
npm install
```

## 3) Configure Environment
- Copy `.env.example` to `.env` and fill values.
- Ensure your MySQL is running and credentials are correct.

## 4) Run
```bash
npm run start
# or: npm run dev  (requires nodemon installed from devDependencies)
```
Visit: http://localhost:4000

On first run, the app will:
- Create the database (if not exists)
- Create required tables
- Create a default admin user from `.env` (ADMIN_USERNAME / ADMIN_PASSWORD)

## 5) Features
- Citizen report form (photo upload to local `/public/uploads`)
- Case ID generation and tracking page
- Admin login (session-based)
- Admin dashboard to view and update status
- Minimal REST API:
  - `POST /api/reports` (multipart/form-data: photo, location, issue_type, description, citizen_name, email, phone) → `{ ok, case_id }`
  - `GET /api/reports/:caseId` → JSON with status and basics

## 6) Security Notes (for demo only)
- Sessions use a simple secret; rotate and harden for production.
- Uploaded files are stored locally; restrict access and scan files for malware in real deployments.
- Add CSRF protections, stricter validations, and audit logs before production use.

## 7) Folder Structure
```
project/
├─ app.js
├─ views/
├─ public/
│  ├─ css/
│  └─ uploads/
├─ package.json
└─ .env.example
```
