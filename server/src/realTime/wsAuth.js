// File => src/realTime/wsAuth.js 
async function wsAuth({ tokenService }, token) {
  if (!token) throw new Error("Missing token");
  const user = await tokenService.verifyAccessToken(token);
  if (!user) throw new Error("Invalid token");
  return user;
}
export { wsAuth };
