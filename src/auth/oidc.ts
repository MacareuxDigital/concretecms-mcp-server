import * as client from 'openid-client'
import { canonical_url, client_id, client_secret } from '../env.js'

export const server: client.ServerMetadata = {
  issuer: canonical_url!,
  authorization_endpoint: canonical_url + '/oauth/2.0/authorize',
  token_endpoint: canonical_url + '/oauth/2.0/token',
}

export const config: client.Configuration = new client.Configuration(
  server,
  client_id!,
  client_secret!
)
