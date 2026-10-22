update public.reps
set is_current_member = true,
    last_seen_at = now()
where bioguideid in (
  'B001323', -- Nicholas J. Begich (Alaska)
  'R000600', -- Aumua Amata Coleman Radewagen (American Samoa)
  'M001238', -- Sarah McBride (Delaware)
  'N000147', -- Eleanor Holmes Norton (District of Columbia)
  'M001219', -- James C. Moylan (Guam)
  'F000482', -- Julie Fedorchak (North Dakota)
  'K000404', -- Kimberlyn King-Hinds (Northern Mariana Islands)
  'H001103', -- Pablo Jose Hernández (Puerto Rico)
  'J000301', -- Dusty Johnson (South Dakota)
  'B001318', -- Becca Balint (Vermont)
  'P000610', -- Stacey E. Plaskett (Virgin Islands)
  'H001096'  -- Harriet M. Hageman (Wyoming)
)
and chamber ilike '%house%'
and congressionaldistrict = 0;
