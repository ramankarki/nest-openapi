# nest-openapi

> 💡 If you use [Nest.js](https://nestjs.com/) with [class-validator](https://www.npmjs.com/package/class-validator), this package is for you.

- [nest-openapi](#nest-openapi)
  - [Motivation](#motivation)
  - [What it does](#what-it-does)
  - [How to use](#how-to-use)
    - [Generate openapi spec with single command](#generate-openapi-spec-with-single-command)
    - [Live preview for development](#live-preview-for-development)
    - [CLI options](#cli-options)
    - [Basic patterns to follow.](#basic-patterns-to-follow)
  - [How it works](#how-it-works)
  - [customization](#customization)
    - [With config file](#with-config-file)
    - [With comments](#with-comments)

## Motivation

> 😇 Life is too short to write API docs manually.

I was tried of using bunch of nest.js swagger decorators for auto generating openapi spec. Code looked ugly. Too much extra code just to get the basic openapi structure.

I looked for a solution that could generate the spec just by looking into the nest.js codebase. I couldn't find any so I built one.

## What it does

<details>
  <summary>This is what it generates. Here is the example.</summary>

```json
{
  "openapi": "3.1.0",
  "info": {
    "title": "User API",
    "version": "1.0.0",
    "description": "An example API to create a user, optionally with a referrer ID."
  },
  "servers": [{ "url": "https://api.example.com/v1" }],
  "paths": {
    "/users/{referrerId}": {
      "post": {
        "summary": "Create a new user",
        "operationId": "createUser",
        "tags": ["Users"],
        "parameters": [{ "$ref": "#/components/parameters/ReferrerId" }],
        "requestBody": {
          "$ref": "#/components/requestBodies/CreateUserRequest"
        },
        "responses": {
          "201": { "$ref": "#/components/responses/UserCreated" },
          "400": { "$ref": "#/components/responses/BadRequest" }
        }
      }
    }
  },
  "components": {
    "parameters": {
      "ReferrerId": {
        "name": "referrerId",
        "in": "path",
        "required": true,
        "description": "The ID of the user who referred the new user",
        "schema": { "type": "string", "example": "ref123" }
      }
    },
    "schemas": {
      "User": {
        "type": "object",
        "properties": {
          "id": { "type": "string", "example": "abc123" },
          "name": { "type": "string", "example": "John Doe" },
          "email": {
            "type": "string",
            "format": "email",
            "example": "john@example.com"
          },
          "createdAt": {
            "type": "string",
            "format": "date-time",
            "example": "2025-01-01T12:00:00Z"
          },
          "referrerId": {
            "type": "string",
            "nullable": true,
            "example": "ref123"
          }
        },
        "required": ["id", "name", "email", "createdAt"]
      },
      "CreateUserInput": {
        "type": "object",
        "properties": {
          "name": { "type": "string", "example": "John Doe" },
          "email": {
            "type": "string",
            "format": "email",
            "example": "john@example.com"
          },
          "password": {
            "type": "string",
            "format": "password",
            "example": "P@ssw0rd!"
          }
        },
        "required": ["name", "email", "password"]
      },
      "Error": {
        "type": "object",
        "properties": {
          "message": { "type": "string", "example": "Invalid request payload" }
        }
      }
    },
    "requestBodies": {
      "CreateUserRequest": {
        "description": "User creation request payload",
        "required": true,
        "content": {
          "application/json": {
            "schema": { "$ref": "#/components/schemas/CreateUserInput" }
          }
        }
      }
    },
    "responses": {
      "UserCreated": {
        "description": "User successfully created",
        "content": {
          "application/json": {
            "schema": { "$ref": "#/components/schemas/User" }
          }
        }
      },
      "BadRequest": {
        "description": "Invalid request payload",
        "content": {
          "application/json": {
            "schema": { "$ref": "#/components/schemas/Error" }
          }
        }
      }
    }
  }
}
```

</details>

## How to use

### Generate openapi spec with single command

```shell
> pnpm add nest-openapi -g
> nest-openapi
```

### Live preview for development

```
nest-openapi -p 8000
```

### CLI options

| option       | default value |
| ------------ | ------------- |
| -o, --output | openapi.json  |
| -p, --port   | 8080          |

### Basic patterns to follow.

Just need to maintain the codebase and follow some basic patterns. The package will handle the rest.

1. Class name in whole project must be unique. Better to use prefix and suffix with class names.
2. While using nest.js decorators i.e. `@Param`, `@Body`, `@Query`, etc. always use class as type annotation and add validations using `class-validator`.
3. Define return type annotation of the endpoint with separate class. It can be a regular class, I'm just used to writing code like below.

Here is the code example

```ts
export class ProductIdDto {
  @IsMongoId()
  productId: string
}

export class ProductUpdateDto {
  @IsNotEmpty()
  @IsString()
  name: string

  @IsNotEmpty()
  @IsString()
  description: string
}

export class ProductSerializer {
  @Expose() id: string
  @Expose() name: string
  @Expose() description: string
  @Expose() @Type(() => Date) createdAt: string
  @Expose() @Type(() => Date) updatedAt: string
}

@Controller('products')
export class ProductController {
  @Patch(':productId')
  async updateProduct(
    @Body() productUpdateDto: ProductUpdateDto,
    @Param() { productId }: ProductIdDto,
  ): Promise<ProductSerializer> {
    // logic here
    console.log({ productId })
    return plainToInstance(ProductSerializer, productUpdateDto, {
      strategy: 'excludeAll',
    })
  }
}
```

## How it works

- To navigate through typescript AST it uses `ts-morph`. It looks for classes with `@Controller` decorator and loops over the methods.
- To generate example for the schemas it uses `@faker-js/faker` with `json-schema-faker`
- To turn dto into schema it uses `class-validator-jsonschema`, since it supports `class-validator` validation decorators.
- To turn response class to schema it uses `ts-json-schema-generator`.
- It uses controller class name and method name for operation id `{controllerClassName}-{methodName}`

## customization

### With config file

Create `nest-openapi.config.ts` file in the project root directory.

```ts
import { Config } from 'nest-openapi'

const config: Config = {
  extends: {
    servers: [
      { url: 'https://dev.example.com', description: 'Development' },
      { url: 'https://example.com', description: 'Production' },
    ],
    components: {
      /** responses below will be included in every operations */
      responses: {
        '401': {
          description: 'Unauthorized',
        },
        '402': {
          description: 'Payment required',
        },
        '500': {
          description: 'Server error',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  error: {
                    type: 'string',
                    example: 'Server error',
                  },
                  message: {
                    type: 'string',
                    example: 'Internal server error',
                  },
                },
              },
            },
          },
        },
      },
    },
  },

  /** glob pattern for typescript AST */
  glob: ['src/**/*.ts', '!src/**/*.spec.ts', '!src/**/*.e2e-spec.ts'],
}

export default config
```

### With comments

1. use js-doc `@tag` and `@description` to have custom tag name and description.

   ```ts
   /**
    * @tag Users
    * @description IT contains APIs to work with users.
    */
   @Controller()
   export class UserController {}
   ```

2. use `@summary`, `@description`, `@deprecated` in endpoints.

   ```ts
     /**
      * @summary Method name
      * @description Use this endpoint do the the task.
      * @deprecated This endpoint is deprecated, use [this](#tag/className-methodName) endpoint.
      */
     @Patch()
     async methodName() {}
   ```

3. use `@description` in the properties of the class.

   ```ts
   class Dto {
     /** @description This is a description. */
     property: string
   }
   ```
