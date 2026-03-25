# User Stories

## 1. Authentication & User Management
- **Sign Up:** As a new visitor, I want to create an account using only an email and password so that I can manage my shared files persistently.
- **Login:** As a returning user, I want to log in securely so that I can access my dashboard and previous links.
- **Simple Navigation:** As a user, I want to be automatically redirected to the **Link List Page** after a successful login so I can start working immediately.
- **Account Page:** As a logged-in user, I want to view my storage quota usage and manage my account settings.

## 2. File Sharing & Link Logic
- **Anonymous Creation (Guest):** As a guest user, I want to upload a file and set a **TTL (Time-to-Live)** so that the file automatically expires after it is no longer needed. TTL is **mandatory** for anonymous uploads — permanent storage requires an account.
- **Authenticated Creation (User):** As a logged-in user, I want to upload files to my **Permanent Quota** or optionally set a TTL for temporary shares.
- **Secure Links (Obfuscation):** As a creator, I want the system to generate a non-sequential, hard-to-guess URL (NanoID, 12 chars) so that unauthorized users cannot scan or brute-force my files.
- **Privacy (Password Protection):** As a creator, I want the option to add a password to my file link so that only recipients with the password can view or download the content.
- **Public Access:** As a recipient, I want to view or download a file shared via a link without needing to create an account.

## 3. Large File Handling
- **Chunked Upload:** As a user with a large file (up to 1 GB), I want the application to upload the file in 16 MB chunks so that the upload is stable, resumable, and doesn't fail due to network timeouts.
- **Multi-Format Support:** As a user, I want to upload any file type (images, PDFs, ZIPs, videos, etc.) without format restrictions.
- **Upload Integrity:** As a user, I want confidence that my file arrived intact. The system should verify the file's SHA-256 checksum after upload.

## 4. Frontend Navigation & UX
- **Homepage Utility:** As a visitor, I want a dual-purpose landing page where I can either:
    - **Enter a Link:** To immediately access a shared file.
    - **Create a Link:** To be guided to the login/upload flow.
- **Link Management (Dashboard):** As a logged-in user, I want a **Link List Page** that displays:
    - All my active links with metadata (file name, size, expiry, status).
    - A prominent "Create Link" bar at the top for quick access.
- **CUD Operations:** As an account holder, I want to **Update** (change password or expiry) or **Delete** my existing links from the management page.
