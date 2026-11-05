import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Matches, MaxLength } from 'class-validator';

export class AddDomainDto {
  @ApiProperty({ example: 'learn.example.com' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase().replace(/\.$/, '') : value))
  @IsString()
  @MaxLength(253)
  @Matches(/^(?=.{4,253}$)(?!-)(?:[a-z0-9-]{1,63}(?<!-)\.)+[a-z]{2,63}$/, { message: 'Enter a valid domain, e.g. learn.example.com' })
  hostname: string;
}

export class AddSubdomainDto {
  @ApiProperty({ example: 'learnwithmeera', description: 'Becomes learnwithmeera.<platform domain>' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsString()
  @MaxLength(40)
  name: string;
}

export class SubdomainQueryDto extends AddSubdomainDto {}
