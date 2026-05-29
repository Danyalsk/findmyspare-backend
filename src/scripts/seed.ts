import { hash } from "bcryptjs";
import { db } from "../db";
import { users, products } from "../db/schema";
import { eq } from "drizzle-orm";

const DEMO_PASSWORD = "demo1234";
const ADMIN_PASSWORD = "Admin1234!";

async function seed() {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_PROD_SEED !== "true") {
    console.error(
      "Refusing to seed in production. Set ALLOW_PROD_SEED=true to override."
    );
    process.exit(1);
  }
  console.log("🌱 Seeding FindMySpare...\n");

  // ─── Users ─────────────────────────────────────────────
  // Exactly: 1 admin + 2 suppliers + 2 buyers
  const userData = [
    {
      email: "admin@findmyspare.test",
      name: "Admin",
      password: ADMIN_PASSWORD,
      role: "admin" as const,
      verificationStatus: "not_submitted" as const,
      businessName: null,
      specialization: null,
      phone: null,
    },
    {
      email: "raza@findmyspare.test",
      name: "Raza",
      password: DEMO_PASSWORD,
      role: "supplier" as const,
      verificationStatus: "approved" as const,
      businessName: "Raza Auto Parts",
      specialization: "Engine, Brakes & Drivetrain",
      phone: "9876543210",
    },
    {
      email: "ayman@findmyspare.test",
      name: "Ayman",
      password: DEMO_PASSWORD,
      role: "supplier" as const,
      verificationStatus: "approved" as const,
      businessName: "Ayman Motors",
      specialization: "Body, Lighting & Suspension",
      phone: "9876543211",
    },
    {
      email: "buyer1@findmyspare.test",
      name: "Arjun Kumar",
      password: DEMO_PASSWORD,
      role: "buyer" as const,
      verificationStatus: "not_submitted" as const,
      businessName: null,
      specialization: null,
      phone: "9123456789",
    },
    {
      email: "buyer2@findmyspare.test",
      name: "Priya Sharma",
      password: DEMO_PASSWORD,
      role: "buyer" as const,
      verificationStatus: "not_submitted" as const,
      businessName: null,
      specialization: null,
      phone: "9123456790",
    },
  ];

  const seededUsers: Record<string, string> = {};

  for (const u of userData) {
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, u.email))
      .limit(1);

    if (existing.length) {
      console.log(`  ⏭  ${u.email} already exists — skipping`);
      seededUsers[u.email] = existing[0].id;
      continue;
    }

    const passwordHash = await hash(u.password, 12);
    const [created] = await db
      .insert(users)
      .values({
        email: u.email,
        name: u.name,
        passwordHash,
        role: u.role,
        verificationStatus: u.verificationStatus,
        businessName: u.businessName,
        specialization: u.specialization,
        phone: u.phone,
        isActive: true,
      })
      .returning({ id: users.id });

    seededUsers[u.email] = created.id;
    console.log(`  ✅ ${u.role.padEnd(8)} ${u.email}`);
  }

  // ─── Products ───────────────────────────────────────────
  // Exactly 6 products: 3 from Raza, 3 from Ayman
  const razaId = seededUsers["raza@findmyspare.test"];
  const aymanId = seededUsers["ayman@findmyspare.test"];

  const productData = [
    // ─── Raza — Engine, Brakes, Drivetrain ───
    {
      supplierId: razaId,
      name: "Air Filter — Maruti Suzuki Swift",
      description:
        "High-performance OEM replacement air filter. Improves airflow, extends engine life. Compatible 2018–2023 Swift.",
      partNumber: "SWF-AF-2018",
      category: "Engine",
      price: "850.00",
      stockQuantity: 25,
      images: [
        "https://images.unsplash.com/photo-1486262715619-67b85e0b08d3?w=800&q=80",
      ],
      specifications: {
        material: "Multi-layer cotton gauze",
        weight: "320g",
        oem_number: "13780-84M00",
      },
      compatibleVehicles: [
        { make: "Maruti Suzuki", model: "Swift", year: "2018-2023" },
        { make: "Maruti Suzuki", model: "Dzire", year: "2017-2023" },
      ],
      warrantyInfo: "6 months manufacturer warranty",
    },
    {
      supplierId: razaId,
      name: "Brake Pad Set — Front — Hyundai i20",
      description:
        "Semi-metallic front brake pads. Low dust, low noise. Excellent heat dissipation for city and highway driving.",
      partNumber: "I20-BP-F",
      category: "Brakes",
      price: "1200.00",
      stockQuantity: 18,
      images: [
        "https://images.unsplash.com/photo-1632823471565-1ec1b54aebbd?w=800&q=80",
      ],
      specifications: {
        material: "Semi-metallic",
        pad_thickness: "12mm",
        noise_level: "Low",
      },
      compatibleVehicles: [
        { make: "Hyundai", model: "i20", year: "2015-2023" },
        { make: "Hyundai", model: "Elite i20", year: "2015-2019" },
      ],
      warrantyInfo: "1 year or 20,000 km — whichever first",
    },
    {
      supplierId: razaId,
      name: "Clutch Plate — Tata Nexon 1.2T",
      description:
        "OEM-spec clutch plate for Nexon petrol. Smooth engagement, reduced slip. Original thickness 8.5mm.",
      partNumber: "NXN-CP-12T",
      category: "Transmission",
      price: "3200.00",
      stockQuantity: 8,
      images: [
        "https://images.unsplash.com/photo-1486006920555-c77dcf18193c?w=800&q=80",
      ],
      specifications: {
        diameter: "215mm",
        thickness: "8.5mm",
        splines: "23",
        oem_number: "306200009601",
      },
      compatibleVehicles: [{ make: "Tata", model: "Nexon", year: "2017-2023" }],
      warrantyInfo: "6 months",
    },

    // ─── Ayman — Body, Lighting, Suspension ───
    {
      supplierId: aymanId,
      name: "Headlight Assembly — Honda City 5th Gen",
      description:
        "Complete projector headlight assembly with DRL. Plug-and-play fitment. Crystal clear lens.",
      partNumber: "CTY5-HL-L",
      category: "Lighting",
      price: "4500.00",
      stockQuantity: 6,
      images: [
        "https://images.unsplash.com/photo-1542362567-b07e54358753?w=800&q=80",
      ],
      specifications: {
        type: "Projector + DRL",
        side: "Left / Driver",
        lens: "PC (Polycarbonate)",
        bulb_type: "H4",
      },
      compatibleVehicles: [{ make: "Honda", model: "City", year: "2014-2019" }],
      warrantyInfo: "3 months",
    },
    {
      supplierId: aymanId,
      name: "Side Mirror — Power Fold — Mahindra XUV500",
      description:
        "OEM replacement power-folding side mirror with turn indicator. LHS. All wiring connectors included.",
      partNumber: "XUV5-SM-L",
      category: "Body",
      price: "2800.00",
      stockQuantity: 12,
      images: [
        "https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=800&q=80",
      ],
      specifications: {
        side: "Left",
        power_fold: "Yes",
        indicator: "Yes",
        finish: "Body-colour cap",
      },
      compatibleVehicles: [
        { make: "Mahindra", model: "XUV500", year: "2012-2021" },
      ],
      warrantyInfo: "6 months",
    },
    {
      supplierId: aymanId,
      name: "Front Shock Absorber — Maruti Suzuki Baleno",
      description:
        "Gas-filled twin-tube shock absorber. Improves ride quality and handling stability on Indian roads.",
      partNumber: "BAL-SA-F",
      category: "Suspension",
      price: "1800.00",
      stockQuantity: 20,
      images: [
        "https://images.unsplash.com/photo-1517524008697-84bbe3c3fd98?w=800&q=80",
      ],
      specifications: {
        type: "Gas-filled twin-tube",
        side: "Front (sold each)",
        travel: "110mm",
        oem_number: "41600M82M10",
      },
      compatibleVehicles: [
        { make: "Maruti Suzuki", model: "Baleno", year: "2015-2023" },
        { make: "Toyota", model: "Glanza", year: "2019-2023" },
      ],
      warrantyInfo: "1 year",
    },
  ];

  console.log("\n📦 Seeding products...\n");

  for (const p of productData) {
    if (!p.supplierId) {
      console.log(`  ⏭  Skipping product "${p.name}" — supplier ID missing`);
      continue;
    }

    // Skip if a product with same partNumber already exists
    const existing = await db
      .select({ id: products.id })
      .from(products)
      .where(eq(products.partNumber, p.partNumber))
      .limit(1);

    if (existing.length) {
      console.log(`  ⏭  ${p.name} already exists — skipping`);
      continue;
    }

    const [created] = await db
      .insert(products)
      .values({
        ...p,
        specifications: p.specifications as unknown as Record<string, string>,
        status: "active",
      })
      .returning({ id: products.id, name: products.name });

    console.log(`  ✅ ${created.name}`);
  }

  console.log("\n✅ Seed complete!\n");
  console.log("Demo accounts:");
  console.log("  admin@findmyspare.test     / Admin1234!");
  console.log("  raza@findmyspare.test      / demo1234  (supplier)");
  console.log("  ayman@findmyspare.test     / demo1234  (supplier)");
  console.log("  buyer1@findmyspare.test    / demo1234  (buyer — Arjun Kumar)");
  console.log("  buyer2@findmyspare.test    / demo1234  (buyer — Priya Sharma)");

  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err.message);
  process.exit(1);
});
