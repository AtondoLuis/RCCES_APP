export function phoneAuthEmail(phone: string) {
  const digits = phone.replace(/\D/g, "");
  return `phone-${digits}@auth.rcces.invalid`;
}
