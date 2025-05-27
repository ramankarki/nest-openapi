import { Expose, Type } from 'class-transformer'

export class ProductSerializer {
	@Expose() id: string
	@Expose() name: string
	@Expose() description: string
	@Expose() @Type(() => Date) createdAt: string
	@Expose() @Type(() => Date) updatedAt: string
}
