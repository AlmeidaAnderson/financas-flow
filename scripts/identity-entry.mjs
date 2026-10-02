// Entrada usada só para gerar site/vendor/netlify-identity.js (npm run vendor:identity).
// Reexporta apenas o que o navegador usa.
export {
  getUser, login, logout, oauthLogin, handleAuthCallback, onAuthChange,
  refreshSession, requestPasswordRecovery, acceptInvite, updateUser, getSettings,
} from '@netlify/identity';
