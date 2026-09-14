# Deployment

- Website: https://the-jo-shop.vercel.app
- Admin: https://the-jo-shop.vercel.app/admin
- GitHub: https://github.com/luma41696-del/THE-JO
- Vercel project: `luma-02c2/the-jo-shop`
- Production branch: `main`
- Firebase project: `the-jo-shop`
- Firestore database: `(default)`, `europe-west1`

Vercel is connected to the GitHub repository. Pushes to `main` publish the
production website. `vercel.json` selects Next.js and the production build.
Firebase settings are configured in Vercel's Production environment; server
credentials are stored as secrets. Never commit `.env.local` or service-account
keys. `.deployment-local/` contains local setup and verification helpers and is
excluded from both Git and Vercel uploads.

Firestore contains the project's existing sample catalogue: 12 products,
6 categories, 6 banners, 2 offers and 4 testimonials. Replace these with the
store's actual inventory and content before commercial launch. Production has
demo fallback disabled. Firestore rules, indexes and Storage rules are deployed.

Email/password sign-in is enabled. Google sign-in stays hidden in production
until its Firebase provider is configured and
`NEXT_PUBLIC_GOOGLE_SIGN_IN_ENABLED=true` is set in Vercel, followed by a new
deployment. Production checkout currently accepts cash on delivery only.
Online payment methods require a working payment integration before enabling.

## Admin access

Store accounts are separate from accounts used to manage Firebase or Vercel.
An administrator must have a Firebase Authentication user in `the-jo-shop`
with the signed custom claim `role: admin`.

After creating a store account, grant access locally:

```sh
npm run grant-admin -- owner@example.com
```

The user must sign in again after a grant, then open `/admin`. Passwords are
chosen by the account owner; do not save them in this repository.
