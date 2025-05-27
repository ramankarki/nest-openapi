import { Controller, Body, Param, Patch } from '@nestjs/common'
import { ProductUpdateDto } from './dto/product-update.dto'
import { ProductIdDto } from './dto/product-id.dto'
import { ProductSerializer } from './serializers/product.serializer'
import { plainToInstance } from 'class-transformer'

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
