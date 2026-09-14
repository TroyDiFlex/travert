// Public configuration only. Never put passwords or income data here.
export const CONFIG = Object.freeze({
  appName: 'Поток',
  // Inert placeholder: this local fork must not connect to the production spreadsheet.
  // The legacy API tests mock fetch and need a URL in the existing API format.
  apiUrl: 'https://script.google.com/macros/s/FINANCE_V2_LOCAL_PLACEHOLDER/exec',
  // Set after the new product gets its final name and remote repository.
  repository: '',
});
