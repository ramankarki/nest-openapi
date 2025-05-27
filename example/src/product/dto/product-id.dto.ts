import { IsMongoId } from 'class-validator'

export class ProductIdDto {
	@IsMongoId()
	productId: string
}
