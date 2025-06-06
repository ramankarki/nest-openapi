import { OpenAPIV3 } from 'openapi-types'

export type Config = {
  extends?: {
    info?: OpenAPIV3.InfoObject
    servers?: OpenAPIV3.ServerObject[]
    components?: {
      responses?: OpenAPIV3.ComponentsObject['responses']
      // securitySchemes?: OpenAPIV3.ComponentsObject['securitySchemes']
    }
  }

  // operationSecurity?: {
  // 	[key: string]: {
  // 		metadata?: string[] | 'all'
  // 		exclude?: string[]
  // 	}
  // }

  /** glob pattern for typescript AST */
  glob?: string[]
}

export type HttpMethod = 'get' | 'post' | 'patch' | 'put' | 'delete'

export type OperationMeta = {
  clsName: string
  type: 'path' | 'query' | 'body'
  operationId: string
  httpMethod: HttpMethod
  path: string
}
