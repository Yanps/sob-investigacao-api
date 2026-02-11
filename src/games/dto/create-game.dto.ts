export class CreateGameDto {
  name: string;
  type: string;
  prompts?: Record<string, unknown>;
  config?: Record<string, unknown>;
}
