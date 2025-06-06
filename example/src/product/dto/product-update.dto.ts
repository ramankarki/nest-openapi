import { Type } from 'class-transformer'
import {
	IsNotEmpty,
	IsOptional,
	IsString,
	ValidateNested,
} from 'class-validator'

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

	@IsOptional()
	@ValidateNested({ each: true })
	@Type(() => ProductMeta)
	meta: ProductMeta[]
}
