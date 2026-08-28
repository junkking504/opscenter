"use client";

import { ChangeEvent, useEffect, useId, useState } from "react";
import Image from "next/image";
import styles from "@/app/my-pay/my-pay.module.css";

async function resizedPhoto(file: File): Promise<string> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error("Choose a JPG, PNG, or WebP image.");
  const source = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new window.Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("That image could not be opened."));
      element.src = source;
    });
    for (const dimension of [640, 512, 400]) {
      const scale = Math.min(1, dimension / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Photo preparation is unavailable in this browser.");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const result = canvas.toDataURL("image/jpeg", 0.82);
      if (result.length <= 1_200_000) return result;
    }
    throw new Error("Use a smaller photo (under 900 KB).");
  } finally { URL.revokeObjectURL(source); }
}

export default function CrewProfileHeader({ employee, firstName, updated, history }: { employee: string; firstName: string; updated: string; history: string }) {
  const inputId = useId();
  const [image, setImage] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const initials = employee.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "CK";

  useEffect(() => {
    fetch("/my-pay/profile-photo", { cache: "no-store" })
      .then(async (result) => result.ok ? result.json() : null)
      .then((payload: { image?: string | null } | null) => setImage(payload?.image || null))
      .catch(() => undefined);
  }, []);

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true); setStatus("");
    try {
      const nextImage = await resizedPhoto(file);
      const result = await fetch("/my-pay/profile-photo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: nextImage }) });
      const payload = await result.json() as { image?: string; error?: string };
      if (!result.ok || !payload.image) throw new Error(payload.error || "Photo upload failed.");
      setImage(payload.image); setStatus("Profile photo saved.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Photo upload failed."); } finally { setBusy(false); }
  }

  async function remove() {
    setBusy(true); setStatus("");
    try {
      const result = await fetch("/my-pay/profile-photo", { method: "DELETE" });
      if (!result.ok) throw new Error("Photo removal failed.");
      setImage(null); setStatus("Profile photo removed.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Photo removal failed."); } finally { setBusy(false); }
  }

  return <section className={styles.profileHero} aria-label="Your Crew Portal profile">
    <div className={styles.profileAvatar}>{image ? <Image className={styles.profileImage} src={image} alt="Your profile" width={116} height={116} unoptimized /> : <span className={styles.profileInitials} aria-hidden="true">{initials}</span>}</div>
    <div className={styles.eyebrow}>Private crew access</div>
    <h1>Hi, {firstName}.</h1>
    <p className={styles.profileEmployee}>{employee}</p>
    <div className={styles.profileActions}>
      <input id={inputId} className={styles.photoInput} type="file" accept="image/jpeg,image/png,image/webp" onChange={upload} />
      <label className={styles.photoButton} htmlFor={inputId}>{busy ? "Saving…" : image ? "Change photo" : "Upload photo"}</label>
      {image ? <button className={styles.removePhoto} type="button" onClick={remove} disabled={busy}>Remove</button> : null}
    </div>
    <p className={styles.photoHint}>JPG, PNG, or WebP. Your photo is visible only in your signed-in Crew Portal.</p>
    {status ? <p className={styles.photoStatus} role="status">{status}</p> : null}
    <p className={styles.profileUpdated}>{updated}<br />{history}</p>
  </section>;
}
