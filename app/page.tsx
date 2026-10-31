import { isAuthenticated } from "@/lib/auth"; import { redirect } from "next/navigation"; import ClinicApp from "@/components/clinic-app"; import Login from "@/components/login";
export default async function Home(){return (await isAuthenticated())?<ClinicApp/>:<Login/>}
