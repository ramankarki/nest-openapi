import { IsNotEmpty, IsString } from 'class-validator'

export class ProductUpdateDto {
	@IsNotEmpty()
	@IsString()
	name: string

	@IsNotEmpty()
	@IsString()
	description: string
}
