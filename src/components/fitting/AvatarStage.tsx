"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import {
  bodyProfile,
  garmentKind,
  garmentRadiusAt,
  garmentSpan,
  type AvatarParams,
  type GarmentKind,
  type GarmentMeasurements,
} from "@/lib/fitting/avatar";
import type { Locale } from "@/types";

/**
 * The 3D stage.
 *
 * Three.js is loaded **on demand** — it is ~600KB gzipped, and a shopper who
 * never opens the fitting room should never pay for it. The import happens
 * inside an effect, after the component is on screen.
 *
 * Everything here is geometry generated from `avatar.ts`: a lathed body from
 * the customer's measurements, and garments lathed to sit on it with the ease
 * their silhouette implies. Nothing is faked: with no measurements there is no
 * avatar, and the caller is told to ask for them.
 *
 * There is no glTF loader here, and the props carry no asset fields. An
 * earlier draft declared `glb` and `decal` and documented them as "loaded when
 * present" — nothing read either one, and no product in the catalogue carries
 * such an asset. A field that describes a capability the code does not have is
 * the same lie as a fake progress bar, just written for the next developer
 * instead of for the customer. What authored garments would actually take is
 * costed in FITTING-ROOM.md.
 */

export interface StageGarment {
  id: string;
  /** Root-first ancestry, so a subcategory still resolves to a shape. */
  categoryPath: string[];
  /** Hex from the chosen colourway. */
  colour: string;
  silhouette: string;
  /**
   * The recommended size's own measurement table, when it has one.
   *
   * Without this every size renders the same shape, and the figure answers a
   * question the customer did not ask.
   */
  measurements?: GarmentMeasurements;
}

export interface AvatarStageProps {
  params: AvatarParams;
  garments: StageGarment[];
  locale?: Locale;
  className?: string;
}

export function AvatarStage({ params, garments, locale = "en", className }: AvatarStageProps) {
  const host = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const rtl = locale === "ar";

  /*
   * The scene is built once and then mutated. Tearing it down and rebuilding
   * on every garment change would drop a WebGL context per swap, and browsers
   * cap how many a page may hold — after a dozen colour taps the canvas goes
   * black and does not come back.
   */
  const scene = useRef<{
    dispose: () => void;
    setGarments: (g: StageGarment[]) => void;
    setBody: (p: AvatarParams) => void;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const node = host.current;
    if (!node) return;

    void (async () => {
      try {
        const THREE = await import("three");
        if (cancelled || !host.current) return;

        const width = node.clientWidth || 400;
        const height = node.clientHeight || 520;

        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(width, height);
        node.appendChild(renderer.domElement);

        /*
         * `pan-y`, not `none`.
         *
         * `none` gave the canvas every touch on it — which on a phone, where
         * the stage is most of the screen, meant a finger dragged down the
         * figure did nothing and the page would not scroll past it. The user
         * was simply stuck. With `pan-y` a vertical drag scrolls the page (the
         * browser sends `pointercancel`, which ends the rotation cleanly) and
         * a horizontal drag still turns the figure.
         */
        renderer.domElement.style.touchAction = "pan-y";

        const sceneObj = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(32, width / height, 0.1, 100);
        camera.position.set(0, 0.95, 4.2);
        camera.lookAt(0, 0.9, 0);

        // Three lights, not one: a single source flattens a lathed form into a
        // silhouette, which is precisely the shape information this is for.
        sceneObj.add(new THREE.HemisphereLight(0xffffff, 0x8a8078, 1.5));
        const key = new THREE.DirectionalLight(0xffffff, 2.2);
        key.position.set(3, 6, 5);
        sceneObj.add(key);
        const rim = new THREE.DirectionalLight(0xffd9d0, 0.8);
        rim.position.set(-4, 3, -4);
        sceneObj.add(rim);

        const root = new THREE.Group();
        sceneObj.add(root);

        const bodyGroup = new THREE.Group();
        const garmentGroup = new THREE.Group();
        root.add(bodyGroup, garmentGroup);

        /* ---- body ---------------------------------------------------- */

        const bodyMaterial = new THREE.MeshStandardMaterial({
          color: 0xded6bd,
          roughness: 0.85,
          metalness: 0,
        });

        /** Metres per centimetre — the scene works in metres. */
        const M = 0.01;

        /*
         * The body the garments are currently cut for.
         *
         * `buildGarments` used to read the `params` prop straight out of the
         * closure, which is the value at mount and never changes. Moving the
         * height slider rebuilt the figure and left the clothes lathed to the
         * old one — they hung in the air beside it. The garments follow this,
         * and `buildBody` is the only thing that moves it.
         */
        let current: AvatarParams = params;

        /** The arm capsules, kept so garments can push them outwards. */
        const arms: {
          mesh: InstanceType<typeof THREE.Mesh>;
          side: number;
          radiusCm: number;
        }[] = [];

        /** Extra centimetres the worn garments add at the shoulder. */
        let shoulderClearanceCm = 0;

        function buildBody(p: AvatarParams) {
          current = p;
          bodyGroup.clear();
          const rings = bodyProfile(p);
          const h = p.heightCm * M;

          const points = rings.map(
            (ring) => new THREE.Vector2(Math.max(0.01, ring.r * M), ring.y * h),
          );
          const geometry = new THREE.LatheGeometry(points, 48);
          const mesh = new THREE.Mesh(geometry, bodyMaterial);
          bodyGroup.add(mesh);

          // Arms, so the shoulder line reads. Simple capsules, angled out.
          const armLength = h * 0.32;
          const armRadius = p.chestCm * M * 0.045;
          arms.length = 0;
          for (const side of [-1, 1]) {
            const arm = new THREE.Mesh(
              new THREE.CapsuleGeometry(armRadius, armLength, 4, 12),
              bodyMaterial,
            );
            arm.position.y = h * 0.66;
            arm.rotation.z = side * 0.14;
            arms.push({ mesh: arm, side, radiusCm: armRadius * 100 });
            bodyGroup.add(arm);
          }
          placeArms();
        }

        /**
         * Slide the arms out to clear whatever the figure is wearing.
         *
         * A lathe cannot make a sleeve, so an arm left at the body's own
         * shoulder width ends up buried in the coat with a slice of bare limb
         * sticking through it — which reads as a broken render rather than as
         * a mannequin. Pushed out by the garment's ease, the same geometry
         * reads as an arm beside a sleeveless shape, which is honest about
         * what this can and cannot draw.
         *
         * `shoulderCm` is a span: half of it is the distance from the spine.
         */
        function placeArms() {
          for (const arm of arms) {
            const x = current.shoulderCm / 2 - arm.radiusCm + shoulderClearanceCm;
            arm.mesh.position.x = arm.side * x * M;
          }
        }

        /* ---- garments ------------------------------------------------ */

        const disposables: Array<{ dispose: () => void }> = [];

        function buildGarments(list: StageGarment[]) {
          // Dispose before clearing: `clear()` detaches but does not free, and
          // a colour swapped fifty times would leak fifty geometries.
          for (const item of disposables.splice(0)) item.dispose();
          garmentGroup.clear();

          const rings = bodyProfile(current);
          const h = current.heightCm * M;

          /*
           * The widest ease among the pieces that actually reach the shoulder.
           * Trousers and shoes are excluded — a wide-leg trouser has no say in
           * where the arms hang.
           */
          shoulderClearanceCm = list.reduce((widest, garment) => {
            const kind = garmentKind(garment.categoryPath);
            if (!kind || kind === "trouser" || kind === "shoe" || kind === "bag") return widest;
            const span = garmentSpan(kind, garment.silhouette);
            return span && span.to > 0.72 ? Math.max(widest, span.ease) : widest;
          }, 0);
          placeArms();

          for (const garment of list) {
            const kind = garmentKind(garment.categoryPath);
            if (!kind) continue;
            const span = garmentSpan(kind, garment.silhouette);
            if (!span) continue;

            const material = new THREE.MeshStandardMaterial({
              color: new THREE.Color(garment.colour || "#1B1717"),
              roughness: 0.72,
              metalness: 0.02,
              side: THREE.DoubleSide,
            });
            disposables.push(material);

            if (kind === "shoe" || kind === "bag") {
              const mesh = buildProp(THREE, kind, current, material, M, h);
              if (mesh) {
                garmentGroup.add(mesh);
                disposables.push(mesh.geometry);
              }
              continue;
            }

            if (span.legs) {
              // Two tubes, offset either side of centre.
              for (const side of [-1, 1]) {
                const points: InstanceType<typeof THREE.Vector2>[] = [];
                for (let t = 0; t <= 1.0001; t += 0.1) {
                  const y = span.from + (span.to - span.from) * t;
                  // Halved, because each leg carries about half the girth the
                  // hip measurement describes.
                  const r =
                    garmentRadiusAt(rings, y, span.ease, garment.measurements) * 0.52 * M;
                  points.push(new THREE.Vector2(Math.max(0.01, r), y * h));
                }
                const geometry = new THREE.LatheGeometry(points, 28);
                const mesh = new THREE.Mesh(geometry, material);
                mesh.position.x = side * current.hipCm * M * 0.08;
                garmentGroup.add(mesh);
                disposables.push(geometry);
              }
              continue;
            }

            const points: InstanceType<typeof THREE.Vector2>[] = [];
            for (let t = 0; t <= 1.0001; t += 0.05) {
              const y = span.from + (span.to - span.from) * t;
              // The chosen size's table where it has one, the silhouette's
              // ease where it does not: a slim top hugs the body, an
              // oversized coat stands 7cm off it, and a size too small
              // renders too small.
              const r = garmentRadiusAt(rings, y, span.ease, garment.measurements) * M;
              points.push(new THREE.Vector2(Math.max(0.01, r), y * h));
            }
            const geometry = new THREE.LatheGeometry(points, 40);
            const mesh = new THREE.Mesh(geometry, material);
            garmentGroup.add(mesh);
            disposables.push(geometry);
          }
        }

        buildBody(params);
        buildGarments(garments);

        /* ---- interaction --------------------------------------------- */

        let yaw = 0.35;
        let pitch = 0;
        let distance = 4.2;
        let dragging = false;
        let lastX = 0;
        let lastY = 0;
        let pinchStart = 0;

        const onPointerDown = (event: PointerEvent) => {
          dragging = true;
          lastX = event.clientX;
          lastY = event.clientY;
          renderer.domElement.setPointerCapture(event.pointerId);
        };
        const onPointerMove = (event: PointerEvent) => {
          if (!dragging) return;
          yaw += (event.clientX - lastX) * 0.01;
          // Pitch is clamped so the model cannot be flipped upside down —
          // a rotation control that loses its horizon is disorienting rather
          // than expressive.
          pitch = Math.max(-0.5, Math.min(0.5, pitch + (event.clientY - lastY) * 0.005));
          lastX = event.clientX;
          lastY = event.clientY;
        };
        const onPointerUp = (event: PointerEvent) => {
          dragging = false;
          try {
            renderer.domElement.releasePointerCapture(event.pointerId);
          } catch {
            /* the pointer may already be gone */
          }
        };
        const onWheel = (event: WheelEvent) => {
          /*
           * Plain scrolling belongs to the page.
           *
           * Taking every wheel event trapped the reader: the stage is tall, so
           * scrolling down the article stopped dead on it and zoomed the
           * mannequin instead. Zoom is on the deliberate gesture — ctrl+wheel,
           * which is also what a trackpad pinch sends.
           */
          if (!event.ctrlKey) return;
          event.preventDefault();
          distance = Math.max(2.4, Math.min(7, distance + event.deltaY * 0.01));
        };
        const onTouchStart = (event: TouchEvent) => {
          if (event.touches.length === 2) {
            const [a, b] = [event.touches[0]!, event.touches[1]!];
            pinchStart = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
          }
        };
        const onTouchMove = (event: TouchEvent) => {
          if (event.touches.length !== 2 || pinchStart === 0) return;
          event.preventDefault();
          const [a, b] = [event.touches[0]!, event.touches[1]!];
          const spread = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
          distance = Math.max(2.4, Math.min(7, distance * (pinchStart / spread)));
          pinchStart = spread;
        };

        const el = renderer.domElement;
        el.addEventListener("pointerdown", onPointerDown);
        el.addEventListener("pointermove", onPointerMove);
        el.addEventListener("pointerup", onPointerUp);
        el.addEventListener("pointercancel", onPointerUp);
        el.addEventListener("wheel", onWheel, { passive: false });
        el.addEventListener("touchstart", onTouchStart, { passive: true });
        el.addEventListener("touchmove", onTouchMove, { passive: false });

        /* ---- loop ---------------------------------------------------- */

        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        let frame = 0;

        const tick = () => {
          frame = requestAnimationFrame(tick);
          // A slow idle turn shows the form is three-dimensional without
          // asking; it stops the moment anyone takes hold of it, and never
          // starts under reduced motion.
          if (!dragging && !reduced) yaw += 0.0025;
          root.rotation.y = yaw;
          root.rotation.x = pitch;
          camera.position.setZ(distance);
          renderer.render(sceneObj, camera);
        };
        tick();

        const onResize = () => {
          if (!host.current) return;
          const w = host.current.clientWidth || 400;
          const hgt = host.current.clientHeight || 520;
          renderer.setSize(w, hgt);
          camera.aspect = w / hgt;
          camera.updateProjectionMatrix();
        };
        const observer = new ResizeObserver(onResize);
        observer.observe(node);

        scene.current = {
          setGarments: buildGarments,
          setBody: buildBody,
          dispose: () => {
            cancelAnimationFrame(frame);
            observer.disconnect();
            el.removeEventListener("pointerdown", onPointerDown);
            el.removeEventListener("pointermove", onPointerMove);
            el.removeEventListener("pointerup", onPointerUp);
            el.removeEventListener("pointercancel", onPointerUp);
            el.removeEventListener("wheel", onWheel);
            el.removeEventListener("touchstart", onTouchStart);
            el.removeEventListener("touchmove", onTouchMove);
            for (const item of disposables.splice(0)) item.dispose();
            bodyMaterial.dispose();
            renderer.dispose();
            el.remove();
          },
        };

        setReady(true);
      } catch {
        // WebGL unavailable, or the chunk failed. The caller shows a still
        // fallback rather than an empty box.
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      scene.current?.dispose();
      scene.current = null;
    };
    // Built once. Updates go through the imperative handles below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /*
   * Rebuild only what actually changed.
   *
   * One effect over both inputs, with the body guarded by a comparison rather
   * than by leaving `garments` out of the dependency list. Omitting it would
   * have worked and lied: the effect really does read `garments`, and a
   * suppressed warning is a note for the next person saying "this is fine"
   * when the honest fix is to say *what* changed.
   *
   * Re-lathing the body on a colour tap is the thing worth avoiding — it is
   * 48 segments of geometry for a change that never touched the figure.
   */
  const lastBody = useRef<string>("");

  useEffect(() => {
    const signature = `${params.heightCm}:${params.chestCm}:${params.waistCm}:${params.hipCm}`;
    if (signature !== lastBody.current) {
      lastBody.current = signature;
      scene.current?.setBody(params);
    }
    scene.current?.setGarments(garments);
  }, [params, garments]);

  return (
    <div className={cn("relative", className)}>
      {/*
        `absolute inset-0`, not `h-full`.

        Three.js writes the pixel size it was given back onto the canvas as an
        inline style. With a host that sized itself to its content, that made a
        loop: canvas grows → host grows → the ResizeObserver hands back a
        bigger box → canvas grows again. It settled at roughly 2,200px tall on
        a phone. Taking the host out of flow means the box is decided entirely
        by the wrapper, and the canvas can never argue with it.
      */}
      <div
        ref={host}
        className="bg-paper-sunken rounded-xl absolute inset-0 overflow-hidden"
        role="img"
        aria-label={
          rtl
            ? "مجسم ثلاثي الأبعاد مبني على قياساتك"
            : "A 3D figure built from your measurements"
        }
      />

      {!ready && !failed && (
        <div className="text-mist absolute inset-0 grid place-items-center text-[0.8125rem]">
          {rtl ? "يُبنى المجسم…" : "Building the figure…"}
        </div>
      )}

      {failed && (
        <div className="text-smoke absolute inset-0 grid place-items-center p-6 text-center text-[0.8125rem]">
          {rtl
            ? "متصفحك لا يدعم العرض ثلاثي الأبعاد. اقتراح المقاس يعمل كالمعتاد."
            : "Your browser cannot render 3D here. The size recommendation still works."}
        </div>
      )}

      {ready && (
        <p className="text-mist pointer-events-none absolute inset-x-0 bottom-2 text-center text-[0.6875rem]">
          {rtl
            ? "اسحب أفقياً للتدوير · قرّص للتكبير"
            : "Drag sideways to turn · pinch to zoom"}
        </p>
      )}
    </div>
  );
}

/**
 * Shoes and bags, which are carried rather than worn and so are not lathed
 * onto the body profile.
 */
function buildProp(
  THREE: typeof import("three"),
  kind: GarmentKind,
  params: AvatarParams,
  material: InstanceType<typeof import("three").MeshStandardMaterial>,
  M: number,
  h: number,
) {
  if (kind === "shoe") {
    const group = new THREE.Mesh(
      new THREE.BoxGeometry(params.hipCm * M * 0.7, h * 0.035, h * 0.09),
      material,
    );
    group.position.y = h * 0.018;
    group.position.z = h * 0.015;
    return group;
  }
  if (kind === "bag") {
    const bag = new THREE.Mesh(
      new THREE.BoxGeometry(h * 0.11, h * 0.13, h * 0.04),
      material,
    );
    // Beside the hand, not beside the room: half the shoulder span plus the
    // width of an arm. At 0.95 of the full span it hung a clear 40cm out and
    // read as an unrelated red box sharing the frame.
    bag.position.set((params.shoulderCm / 2 + 8) * M, h * 0.46, 0.06);
    return bag;
  }
  return null;
}
