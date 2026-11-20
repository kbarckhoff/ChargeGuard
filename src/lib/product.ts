// Which product this deployment is: "chargeguard" or "converge". Set via the
// NEXT_PUBLIC_PRODUCT env var per Vercel project (Converge sets "converge");
// defaults to "chargeguard". Used to brand-partition clients (organizations)
// so each app only ever sees its own clients, users, and data.
export const PRODUCT = (process.env.NEXT_PUBLIC_PRODUCT || "chargeguard").toLowerCase();
