import { api } from './client';

export interface StaffSearchHit {
  id: string;
  name: string;
  employeeNo: string;
  email: string;
  departmentName: string;
  designation: string;
  score: number;
}

export interface StaffSearchResponse {
  items: StaffSearchHit[];
  total: number;
}

export const searchApi = {
  staff: (q: string, limit = 20, offset = 0): Promise<StaffSearchResponse> => {
    const params = new URLSearchParams({
      q,
      limit: String(limit),
      offset: String(offset),
    });
    return api<StaffSearchResponse>(`/api/v1/search/staff?${params}`);
  },
};
