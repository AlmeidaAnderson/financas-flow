// Descobre o usuário VERIFICADO da requisição (Netlify Functions v2).
//
// 1) getUser() de @netlify/identity é o método documentado:
//    https://docs.netlify.com/manage/security/secure-access-to-sites/identity/use-identity-in-functions/
// 2) Defesa extra: quando o runtime fornece o contexto de Identity com token de operador
//    (cabeçalho interno x-nf-identity-info → globalThis.netlifyIdentityContext), exigimos que
//    ele traga as claims do usuário (vindas do "Authorization: Bearer <jwt>" que o app sempre
//    envia) e que o `sub` delas seja o MESMO id devolvido por getUser(). Assim, uma requisição sem
//    token do usuário nunca é aceita, mesmo que algo no caminho devolva um usuário "genérico".
export function makeVerifiedUser(getUser, getIdentityContext = () => globalThis.netlifyIdentityContext) {
  return async function verifiedUser() {
    let user = null;
    try { user = await getUser(); } catch { user = null; }
    if (!user || typeof user.id !== 'string' || !user.id) return null;
    let ic = null;
    try { ic = getIdentityContext() || null; } catch { ic = null; }
    // Com token de operador no contexto, getUser() não olha o cookie: o usuário só pode vir das
    // claims verificadas pelo runtime (ou de uma consulta feita com o token de operador). Exige as claims.
    if (ic && ic.token) {
      const sub = ic.user && typeof ic.user.sub === 'string' ? ic.user.sub : null;
      if (!sub || sub !== user.id) return null;
    }
    return { id: user.id, email: user.email || '' };
  };
}
