"use client";

import { ArrowRight, BriefcaseBusiness, Building2, Factory, GraduationCap, Hash, Mail, MapPin, Phone, ShoppingBag, UserRound } from "lucide-react";
import Link from "next/link";
import { useActionState, useState, type FormEvent } from "react";
import { signUpAction, type FormState } from "@/app/auth/actions";
import { AuthLayout, DemoModeNote, FormAlert, PasswordField, SubmitButton, TextField } from "@/components/auth";
import { cx, inputClass } from "@/components/ui";
import { authEnabled } from "@/lib/auth/config";
import { ADVISER_ROLES, validateRegistration, type AccountType, type FieldErrors, type RegistrationInput } from "@/lib/auth/validation";

const TYPES: { id: AccountType; title: string; body: string; icon: typeof Factory }[] = [
  { id: "supplier", title: "MSME supplier", body: "Track invoices and recover overdue payments", icon: Factory },
  { id: "buyer", title: "Buyer / enterprise", body: "You buy goods or services from suppliers", icon: ShoppingBag },
  { id: "adviser", title: "Adviser", body: "Legal, financial or business support. Needs approval", icon: BriefcaseBusiness },
];

const FIELDS: (keyof RegistrationInput)[] = ["accountType", "fullName", "businessName", "email", "mobile", "password",
  "confirmPassword", "businessAddress", "udyam", "professionalRole", "qualifications"];

export default function RegisterPage() {
  const [state, action, pending] = useActionState<FormState, FormData>(signUpAction, {});
  const [type, setType] = useState<AccountType>((state.values?.accountType as AccountType) || "supplier");
  const [local, setLocal] = useState<FieldErrors>({});
  const errors: FieldErrors = { ...state.fieldErrors, ...local };
  const v = state.values ?? {};

  function check(e: FormEvent<HTMLFormElement>) {
    const fd = new FormData(e.currentTarget);
    const input = Object.fromEntries(FIELDS.map((k) => [k, String(fd.get(k) ?? "")])) as unknown as RegistrationInput;
    const found = validateRegistration(input);
    setLocal(found);
    if (Object.keys(found).length) {
      e.preventDefault();
      const first = FIELDS.find((k) => found[k]);
      if (first) document.getElementById(first === "accountType" ? "type-supplier" : first)?.focus();
    }
  }

  return (
    <AuthLayout wide title="Create your account" subtitle="Choose the kind of account that fits you">
      <form action={action} onSubmit={check} className="space-y-5" noValidate>
        {state.error && <FormAlert tone="error">{state.error}</FormAlert>}

        <fieldset>
          <legend className="text-sm font-medium">Account type</legend>
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            {TYPES.map(({ id, title, body, icon: Icon }) => (
              <label key={id} htmlFor={`type-${id}`}
                className={cx("relative flex cursor-pointer flex-col gap-1 rounded-xl border p-4 text-sm transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand-600",
                  type === id ? "border-brand-600 bg-brand-50 ring-1 ring-brand-600" : "border-slate-200 hover:border-slate-300")}>
                <input id={`type-${id}`} type="radio" name="accountType" value={id} checked={type === id}
                  onChange={() => setType(id)} className="sr-only" />
                <Icon size={22} className={type === id ? "text-brand-600" : "text-slate-500"} aria-hidden />
                <span className="font-semibold">{title}</span>
                <span className="text-slate-600">{body}</span>
              </label>
            ))}
          </div>
          {errors.accountType && <p className="mt-1 text-sm text-red-700">{errors.accountType}</p>}
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField id="fullName" label="Full name" icon={UserRound} autoComplete="name" defaultValue={v.fullName} error={errors.fullName} required />
          <TextField id="businessName" key={`bn-${type}`} label={type === "adviser" ? "Firm or practice name" : "Business name"}
            optional={type === "adviser"} icon={Building2} autoComplete="organization" defaultValue={v.businessName} error={errors.businessName} />
          <TextField id="email" label="Email address" icon={Mail} type="email" autoComplete="email" inputMode="email"
            defaultValue={v.email} error={errors.email} hint="We'll send a link to verify it." required />
          <TextField id="mobile" label="Mobile number" icon={Phone} type="tel" autoComplete="tel" inputMode="tel"
            placeholder="98765 43210" defaultValue={v.mobile} error={errors.mobile} required />
          <PasswordField id="password" autoComplete="new-password" error={errors.password}
            hint="At least 8 characters, with a letter and a number." />
          <PasswordField id="confirmPassword" label="Confirm password" autoComplete="new-password" error={errors.confirmPassword} />
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="mb-3 text-sm font-semibold">
            {type === "supplier" ? "Your business" : type === "buyer" ? "Your organisation" : "Your professional details"}
          </p>
          {type !== "adviser" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField id="businessAddress" key={`addr-${type}`} label="Business address" icon={MapPin} autoComplete="street-address"
                className={type === "buyer" ? "sm:col-span-2" : undefined} defaultValue={v.businessAddress} error={errors.businessAddress} />
              {type === "supplier" && (
                <TextField id="udyam" label="Udyam Registration Number" optional icon={Hash} placeholder="UDYAM-KA-01-1234567"
                  defaultValue={v.udyam} error={errors.udyam} hint="You can add it later. It decides whether the MSMED Act protects you." />
              )}
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="professionalRole" className="text-sm font-medium">Professional role</label>
                <select id="professionalRole" name="professionalRole" defaultValue={v.professionalRole ?? ""}
                  aria-invalid={errors.professionalRole ? true : undefined}
                  aria-describedby={errors.professionalRole ? "professionalRole-error" : undefined}
                  className={cx(inputClass, "mt-1 py-2.5", errors.professionalRole && "border-red-400")}>
                  <option value="">Choose…</option>
                  {ADVISER_ROLES.map((r) => <option key={r}>{r}</option>)}
                </select>
                {errors.professionalRole && <p id="professionalRole-error" className="mt-1 text-sm text-red-700">{errors.professionalRole}</p>}
              </div>
              <TextField id="qualifications" label="Qualifications" icon={GraduationCap} placeholder="e.g. ICAI member no. 123456"
                defaultValue={v.qualifications} error={errors.qualifications} />
              <p className="text-sm text-slate-600 sm:col-span-2">
                Adviser accounts are checked by an administrator before they can open the adviser portal. You can sign in meanwhile and will see your approval status.
              </p>
            </div>
          )}
        </div>

        <SubmitButton pending={pending} pendingLabel="Creating account…" disabled={!authEnabled}>
          Create account <ArrowRight size={18} aria-hidden />
        </SubmitButton>
        {!authEnabled && <DemoModeNote />}
        <p className="text-center text-sm">
          Already have an account? <Link href="/login" className="font-semibold text-brand-600 hover:underline">Sign in</Link>
        </p>
      </form>
    </AuthLayout>
  );
}
