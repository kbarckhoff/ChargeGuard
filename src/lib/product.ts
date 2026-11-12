// Product identity. On the `converge` branch this is Converge; on `main` it stays
// ChargeGuard. Keeping it in one place lets the shell be rebranded without hunting
// through the UI. Import PRODUCT.name wherever the app shows its own name.
export const PRODUCT = {
  name: "Converge",
  tagline: "Automated revenue-cycle & CDM diagnostic",
  // The four standard inputs CONVERGE ingests (CDM + R&U today; claims/remits next).
  shortName: "Converge",
};
