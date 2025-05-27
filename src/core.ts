import { Program } from 'typescript'
import 'reflect-metadata'
import { readFileSync, writeFileSync } from 'fs'
import { OpenAPIV3 } from 'openapi-types'
import {
  Project,
  ClassDeclaration,
  SyntaxKind,
  Decorator,
  MethodDeclaration,
  JSDoc,
  ParameterDeclaration,
  SourceFile,
} from 'ts-morph'
import { join, resolve } from 'path'
import { register } from 'esbuild-register/dist/node'
import type { Config, HttpMethod, OperationMeta } from './types'
import { error } from './error'
import { JSONSchemaFaker } from 'json-schema-faker'
import { faker } from '@faker-js/faker'
import { getMetadataStorage as classValidatorMetadataStorage } from 'class-validator'
import { validationMetadatasToSchemas } from 'class-validator-jsonschema'
const { defaultMetadataStorage } = require('class-transformer/cjs/storage')
import {
  SchemaGenerator,
  createParser,
  createFormatter,
  DEFAULT_CONFIG,
  CompletedConfig,
} from 'ts-json-schema-generator'

/** extend json faker */
JSONSchemaFaker.extend('faker', () => faker)
JSONSchemaFaker.format('url', () => faker.internet.url())
JSONSchemaFaker.format('credit-card', () => faker.finance.creditCardNumber())

/** initialize utils */
register({ extensions: ['.ts'] })
const project = new Project({
  tsConfigFilePath: 'tsconfig.json',
  skipAddingFilesFromTsConfig: true,
})
const sourceFiles: SourceFile[] = []
const pkg = JSON.parse(readFileSync('./package.json', 'utf8'))

/** map of all the classes that exist in the project */
const clsMap = new Map<string, ClassDeclaration>()

/** controller classes filtered from clsMap */
const controllers: ClassDeclaration[] = []

/**
 * list of classes to generate schema later
 * will use to inject params in the operation later */
const operationReqMeta: OperationMeta[] = []
const operationResMeta: string[] = []

const userApiTags: Record<'name' | 'description', string>[] = []
const adminApiTags: Record<'name' | 'description', string>[] = []

const endpointDecorators: HttpMethod[] = [
  'get',
  'post',
  'patch',
  'put',
  'delete',
]

/** will be loaded inside main */
const userConfig: Config = {}
const oas: Partial<OpenAPIV3.Document> = {}
const commonOperationResponse: OpenAPIV3.ResponsesObject = {}

export function initState() {
  clsMap.clear()
  Object.assign(oas, {
    openapi: '3.1.0',
    info: {
      title: pkg.name,
      version: pkg.version,
      license: {
        name: pkg.license,
        url: pkg.license,
      },
    },
    servers: [],
    paths: {},
    components: {
      parameters: {},
      requestBodies: {},
      responses: {
        '200': {
          description: 'Successful',
        },
        '204': {
          description: 'The response body is empty',
        },
        '400': {
          description: 'Bad request',
        },
        '500': {
          description: 'Internal server error',
        },
      },
      schemas: {},
    },
  })
  controllers.length = 0
  operationReqMeta.length = 0
  operationResMeta.length = 0
  userApiTags.length = 0
  adminApiTags.length = 0
  Object.assign(
    commonOperationResponse,
    Object.keys(oas.components.responses)
      .filter((status) => !['200', '204'].includes(status))
      .reduce(
        (obj, status) => ({
          ...obj,
          [status]: { $ref: `#/components/responses/${status}` },
        }),
        {},
      ),
  )
}

function collectCls() {
  const classes = sourceFiles.flatMap((sourceFile) => sourceFile.getClasses())
  classes.forEach((cls) => {
    const clsName = cls.getName()
    if (!clsName) return

    /** throw if found duplicate class names in multiple location */
    const clsAlreadyExists = clsMap.get(clsName)
    if (clsAlreadyExists)
      error(`Duplicate ${clsName} class found in multiple locations`, [
        clsAlreadyExists,
        cls,
      ])

    if (cls.getDecorator('Controller')) controllers.push(cls)
    clsMap.set(clsName, cls)
  })
}

function getDecoratorRoute(decorator: Decorator) {
  const node = decorator
    .getCallExpression()
    .getChildrenOfKind(SyntaxKind.SyntaxList)[0]
  const routeName = node.getText()
  return `${routeName}`.replace(/['"]/g, '') || '/'
}

function turnRouteToTag(route: string) {
  if (route === '/') return 'General'
  return route
    .split('/')
    .map((path) => path[0].toUpperCase() + path.slice(1))
    .join(' - ')
}

function extractJsDocs(jsDocs: JSDoc[]) {
  const docs = {
    description: '',
    tag: '',
    deprecated: '',
    summary: '',
  }

  jsDocs.forEach((jsDoc) => {
    docs.description = jsDoc.getCommentText()
    const jsDocTag = jsDoc.getTags()
    jsDocTag.forEach((jsDocTag) => {
      const docsKeys = Object.keys(docs)
      const jsDocTagName = jsDocTag.getTagName()

      if (docsKeys.includes(jsDocTagName))
        docs[jsDocTagName] = jsDocTag.getCommentText()
    })
  })
  return docs
}

function appendOasTag(
  route: string,
  jsDoc: Record<'tag' | 'description', string>,
) {
  const tag = {
    name: jsDoc.tag || turnRouteToTag(route),
    get description() {
      return jsDoc.description || `Contains ${tag.name} APIs.`
    },
  }

  const findTag = ({ name }) => name === tag.name
  const alreadyExists = userApiTags.find(findTag) || adminApiTags.find(findTag)
  if (alreadyExists) return tag

  if (route.includes('admin')) adminApiTags.push(tag)
  else userApiTags.push(tag)
  return tag
}

function getOasPath(...routes: string[]) {
  let fullRoute = join(...routes)
  if (fullRoute === '/') return '/'

  fullRoute = fullRoute
    .split('/')
    .map((route) => (route.startsWith(':') ? `{${route.slice(1)}}` : route))
    .join('/')
  fullRoute = fullRoute.startsWith('/') ? fullRoute : `/${fullRoute}`
  const path = fullRoute.endsWith('/')
    ? fullRoute.slice(0, fullRoute.length - 1)
    : fullRoute
  return path
}

function pascalCase(str: string) {
  if (!str.length) return str
  return str[0].toUpperCase() + str.slice(1)
}

function getParameterClsNames(parameter: ParameterDeclaration) {
  /** get the dto class names, might be multiple */
  const dtoClassNames = parameter
    .getTypeNode()
    ?.getText()
    .split(/[&|]/)
    .map((clsName) => clsName.trim())

  if (!dtoClassNames?.length) error(`parameter must have a class`, [parameter])

  return dtoClassNames
}

function collectParameterClasses(
  method: MethodDeclaration,
  path: string,
  httpMethod: HttpMethod,
  operationId: string,
) {
  const pathParameter = method
    .getParameters()
    .filter((parameter) => parameter.getDecorator('Param'))
    .at(0)
  const queryParameter = method
    .getParameters()
    .filter((parameter) => parameter.getDecorator('Query'))
    .at(0)

  if (pathParameter) {
    const pathClsNames = getParameterClsNames(pathParameter)
    pathClsNames.map((clsName) =>
      operationReqMeta.push({
        clsName,
        type: 'path',
        operationId,
        path,
        httpMethod,
      }),
    )
  }

  if (queryParameter) {
    const queryClsNames = getParameterClsNames(queryParameter)
    queryClsNames.map((clsName) =>
      operationReqMeta.push({
        clsName,
        type: 'query',
        operationId,
        path,
        httpMethod,
      }),
    )
  }
}

function operationBody(
  method: MethodDeclaration,
  path: string,
  httpMethod: HttpMethod,
  operationId: string,
): OpenAPIV3.ReferenceObject | null {
  const bodyParameter = method
    .getParameters()
    .filter((parameter) => parameter.getDecorator('Body'))
    .at(0)
  if (!bodyParameter) return null

  const unionCls = getParameterClsNames(bodyParameter).join('-')
  oas.components.requestBodies[unionCls] = {
    content: {
      'application/json': {
        schema: { $ref: `#/components/schemas/${unionCls}` },
      },
    },
  }
  operationReqMeta.push({
    clsName: unionCls,
    type: 'body',
    operationId,
    path,
    httpMethod,
  })
  return { $ref: `#/components/requestBodies/${unionCls}` }
}

function operationResponses(method: MethodDeclaration) {
  const responses = { ...commonOperationResponse }
  const returnClsName = method
    .getReturnTypeNode()
    ?.getText()
    .replace(/Promise|<|>/g, '')

  const isValidClsName =
    returnClsName && !['void', 'unknown', 'any'].includes(returnClsName)
  if (isValidClsName) {
    oas.components.responses[returnClsName] = {
      description: 'Success',
      content: {
        'application/json': {
          schema: { $ref: `#/components/schemas/${returnClsName}` },
        },
      },
    }
    responses['200'] = { $ref: `#/components/responses/${returnClsName}` }
    operationResMeta.push(returnClsName)
  } else responses['204'] = { $ref: `#/components/responses/204` }
  return responses
}

function extractOasMetadata() {
  const methodDecorators = controllers.flatMap((controller) =>
    controller.getMethods().flatMap((method) => method.getDecorators()),
  )
  methodDecorators.map((methodDecorator) => {
    const methodDecoratorName = methodDecorator
      .getName()
      .toLowerCase() as HttpMethod
    if (!endpointDecorators.includes(methodDecoratorName)) return

    const method = methodDecorator.getParent() as MethodDeclaration
    const controller = method.getParent() as ClassDeclaration
    const controllerDecorator = controller.getDecorator('Controller')

    const controllerRoute = getDecoratorRoute(controllerDecorator)
    const controllerJsDoc = extractJsDocs(controller.getJsDocs())
    const { name: oasTagName } = appendOasTag(controllerRoute, controllerJsDoc)

    const methodRoute = getDecoratorRoute(methodDecorator)
    const path = getOasPath(controllerRoute, methodRoute)
    oas.paths[path] ||= {}
    const methodJsDocs = extractJsDocs(method.getJsDocs())
    const operationId = `${controller.getName()}-${method.getName()}`

    collectParameterClasses(method, path, methodDecoratorName, operationId)

    oas.paths[path][methodDecoratorName] = {
      operationId,
      summary: methodJsDocs.summary || pascalCase(method.getName()),
      description: methodJsDocs.description,
      tags: [oasTagName],
      responses: operationResponses(method),
      security: [] /** @TODO */,
    } as OpenAPIV3.OperationObject

    /** add body only if exists */
    const requestBody = operationBody(
      method,
      path,
      methodDecoratorName,
      operationId,
    )
    if (requestBody)
      oas.paths[path][methodDecoratorName].requestBody = requestBody

    /** mark operation as deprecated if controller or method is deprecated */
    const controllerOrMethodDeprecated =
      controllerJsDoc.deprecated || methodJsDocs.deprecated
    if (controllerOrMethodDeprecated)
      oas.paths[path][methodDecoratorName] = {
        deprecated: true,
        description: `${oas.paths[path][methodDecoratorName].description}\n\n${controllerOrMethodDeprecated}`,
      } as OpenAPIV3.OperationObject
  })
}

function extractClsDescriptions(classDeclaration: ClassDeclaration) {
  const descriptions: { [key: string]: string } = {}
  for (const property of classDeclaration.getProperties()) {
    const jsDoc = property.getJsDocs()[0] // Get the first JSDoc comment
    if (jsDoc) {
      const descriptionTag = jsDoc
        .getTags()
        .find((tag) => tag.getTagName() === 'description')
      if (descriptionTag) {
        descriptions[property.getName()] = descriptionTag.getCommentText() || ''
      }
    }
  }
  return descriptions
}

async function generateReqSchema() {
  /** import all the dto class files to generate schema at once */
  await Promise.all(
    operationReqMeta.map(({ clsName, operationId }) => {
      const clsDeclaration = clsMap.get(clsName)
      if (!clsDeclaration)
        error(`${clsName} class doesn't exists but used in ${operationId}`)

      return import(clsDeclaration.getSourceFile().getFilePath())
    }),
  )

  const schemas = validationMetadatasToSchemas({
    classValidatorMetadataStorage: classValidatorMetadataStorage(),
    classTransformerMetadataStorage: defaultMetadataStorage,
    refPointerPrefix: '#/components/schemas/',
  }) as Record<string, OpenAPIV3.SchemaObject>

  /** extract @-description manually since class-validator-jsonschema doesn't handle */
  Object.entries(schemas).forEach(([key, schema]) => {
    const descriptions = extractClsDescriptions(clsMap.get(key))
    Object.entries(descriptions).forEach(([property, desc]) => {
      schema.properties[property]['description'] = desc
    })
  })
  Object.assign(oas.components.schemas, schemas)

  /** inject parameters in all the operations */
  operationReqMeta.map(({ path, httpMethod, clsName, operationId, type }) => {
    /** just for the parameters */
    if (type === 'body') return

    /** check if schema exists since class-validator-jsonschema only parses valid dto */
    if (!oas.components.schemas[clsName])
      error(`${clsName} in ${operationId} must be valid class-validator dto`)

    const fields = Object.keys(oas.components.schemas[clsName]['properties'])
    fields.forEach((field) => {
      const parameterKey = `${clsName}-${field}`
      oas.paths[path][httpMethod]['parameters'] ||= []
      oas.paths[path][httpMethod]['parameters'].push({
        $ref: `#/components/parameters/${parameterKey}`,
      })
      oas.components.parameters[parameterKey] = {
        name: field,
        in: type,
        required: oas.components.schemas[clsName]['required']?.includes(field),
        schema: { $ref: `#/components/schemas/${clsName}/properties/${field}` },
      }
    })
  })
}

function generateResSchema() {
  const config: CompletedConfig = {
    ...DEFAULT_CONFIG,
    tsconfig: './tsconfig.json',
    discriminatorType: 'open-api',
    topRef: true,
  }

  const program = project.getProgram().compilerObject as unknown as Program
  const generator = new SchemaGenerator(
    program,
    createParser(program, config),
    createFormatter(config),
  )
  operationResMeta.map((clsName) => {
    const clsDeclaration = clsMap.get(clsName)
    if (!clsDeclaration) error(`${clsName} class doesn't exists but used in `)

    const schemas = generator.createSchema(clsName)
    const updatedSchema = JSON.parse(
      JSON.stringify(schemas).replace(
        /#\/definitions/g,
        '#/components/schemas',
      ),
    )
    Object.assign(oas.components.schemas, updatedSchema.definitions || {})
  })
}

async function injectExample() {
  const examples = await JSONSchemaFaker.resolve({
    components: { schemas: structuredClone(oas.components.schemas) },
  })
  Object.entries(examples.components.schemas).forEach(([k, example]) => {
    Object.assign(oas.components.schemas[k], { example })
  })
}

export function saveOAS(path: string) {
  /** sort tags */
  userApiTags.sort((a, b) => a.name.localeCompare(b.name))
  adminApiTags.sort((a, b) => a.name.localeCompare(b.name))
  oas.tags = userApiTags.concat(adminApiTags)

  writeFileSync(path, JSON.stringify(oas, null, 2))
  console.info(`Openapi ready ${path}`)
}

export function loadConfig() {
  const defaultConfig: Config = {
    glob: ['!src/**/*.spec.ts', '!src/**/*.e2e-spec.ts', 'src/**/*.ts'],
  }
  const configPath = resolve(process.cwd(), 'nest-openapi.config.ts')
  try {
    const { default: config } = require(configPath) as { default: Config }
    if (!config) throw new Error('Config must have const export')
    Object.assign(defaultConfig, config)

    if (config.extends?.info) oas.info = config.extends.info
    if (config.extends?.servers) oas.servers = config.extends.servers
    if (config.extends?.components?.responses)
      oas.components.responses = {
        ...oas.components.responses,
        ...config.extends.components.responses,
      }
    // if (config.extends?.components?.securitySchemes)
    // 	oas.components.securitySchemes = config.extends.components.securitySchemes
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND') return
    error(`config import failed ${configPath}\n${err.message}`)
  }
  Object.assign(userConfig, defaultConfig)
  return defaultConfig
}

export function readSourceFiles() {
  sourceFiles.push(...project.addSourceFilesAtPaths(userConfig.glob))
}

export function updateSourceFiles(path: string) {
  const existingSourceFile = project.getSourceFile(path)
  if (existingSourceFile) existingSourceFile.refreshFromFileSystemSync()
  else project.addSourceFileAtPath(path)
}

export async function generateOAS() {
  collectCls()
  extractOasMetadata()

  await generateReqSchema()
  generateResSchema()

  await injectExample()
}
