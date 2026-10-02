// Netlify Function (API moderna/v2) — rotas /api/*
// Autenticação: getUser() de @netlify/identity (valida o login no Netlify Identity do site),
// conferido com as claims do contexto de Identity do runtime. Sem usuário válido → 401.
// Docs: https://docs.netlify.com/manage/security/secure-access-to-sites/identity/use-identity-in-functions/
import { getStore } from '@netlify/blobs';
import { getUser } from '@netlify/identity';
import { createHandler } from '../lib/api-core.mjs';
import { makeVerifiedUser } from '../lib/verified-user.mjs';

export default createHandler({
  getUser: makeVerifiedUser(getUser),
  getStore: () => getStore({ name: 'finflow', consistency: 'strong' }),
});

export const config = {
  path: ['/api/*'],
  method: ['GET', 'PUT', 'DELETE'],
};
