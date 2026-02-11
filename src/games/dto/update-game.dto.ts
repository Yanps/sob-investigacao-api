export class UpdateGameDto {
  name?: string;
  type?: string;
  prompts?: Record<string, unknown>;
  config?: Record<string, unknown>;
  active?: boolean;
}
