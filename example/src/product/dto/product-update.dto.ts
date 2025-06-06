import { Type } from 'class-transformer'
import { IsNotEmpty, IsString, ValidateNested } from 'class-validator'

class ProductMeta {
	@IsString()
	key: string

	@IsString()
	value: string
}

export class ProductUpdateDto {
	@IsNotEmpty()
	@IsString()
	name: string

	@IsNotEmpty()
	@IsString()
	description: string

	@ValidateNested({ each: true })
	@Type(() => ProductMeta)
	meta: ProductMeta[]
}
