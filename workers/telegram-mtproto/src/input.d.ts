declare module "input" {
  const input: {
    text: (label: string) => Promise<string>;
  };
  export default input;
}
