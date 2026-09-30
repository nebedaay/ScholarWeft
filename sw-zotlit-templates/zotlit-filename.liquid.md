{%- comment -%}Source: ScholarWeft (installed and maintained by the ScholarWeft plugin).{%- endcomment -%}
@{{ zt.citationKey | default: zt.DOI | default: zt.title | default: zt.key }}{% suffix %}
