import { Type } from 'class-transformer'
import {
	IsEnum,
	IsNotEmpty,
	IsOptional,
	IsString,
	ValidateNested,
} from 'class-validator'

enum ProductMetaKeys {
	TEST1 = 'TEST1',
	TEST2 = 'TEST2',
}

class ProductMeta {
	@IsEnum(ProductMetaKeys)
	key: keyof typeof ProductMetaKeys

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
